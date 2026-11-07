// resil_hpc: C++17 + OpenMP Monte Carlo survival simulation, exposed to Python with pybind11.
//
// Same model, argument order and return shapes as sim_numpy.py (the reference and fallback):
//   simulate_one(params[7], shock[k], n_paths, months, seed, target)  -> dict
//   simulate_bank(params[n,7], shock[k], n_paths, months, seed, target) -> (survival[n], median_ruin[n])
//   sweep(params[n,7], shocks[m,k], n_paths, months, seed, target)     -> survival[m, n]
//
// Every (account, path) pair gets its own xoshiro256+ stream seeded from (seed, account, path),
// so results are identical whatever the thread count. No Python objects are touched inside the
// parallel loops; the GIL is released for the whole simulation.

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <omp.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

namespace py = pybind11;
using arr = py::array_t<double, py::array::c_style | py::array::forcecast>;

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kSurviveEps = 0.05;  // judges round runway to 0.1 months

// Per-account parameter columns (risk.PARAM_COLUMNS).
enum Par { P_I, P_S, P_H, P_B, P_SD_IN, P_SD_OUT, P_JOB, N_PAR };

// Scenario vector layout (risk.SHOCK_FIELDS).
enum Shk {
    K_FACTOR, K_INC_MONTHS, K_BILLS_PCT, K_SPEND_DELTA, K_ONE_OFF, K_ONE_OFF_XS, K_EI_CAP, K_NOISE,
    K_JOB_LOSS, K_EI_RATE, K_EI_MONTHS_RANDOM, K_BILLS_GROWTH, K_REPAIR_RATE, K_REPAIR_LO, K_REPAIR_HI, N_SHK
};

// ----------------------------------------------------------------------------- random numbers

inline std::uint64_t splitmix64(std::uint64_t& x) {
    std::uint64_t z = (x += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}

struct Xoshiro256Plus {
    std::uint64_t s[4];

    Xoshiro256Plus(std::uint64_t seed, std::uint64_t account, std::uint64_t path) {
        std::uint64_t x = seed ^ (account * 0xD1B54A32D192ED03ULL) ^ (path * 0xABC98388FB8FAC03ULL);
        for (auto& w : s) w = splitmix64(x);
    }
    static inline std::uint64_t rotl(std::uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
    inline std::uint64_t next() {
        const std::uint64_t r = s[0] + s[3];
        const std::uint64_t t = s[1] << 17;
        s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
        s[2] ^= t; s[3] = rotl(s[3], 45);
        return r;
    }
    // Uniform in (0, 1) from 32 bits.
    static inline double u32(std::uint32_t x) { return (static_cast<double>(x) + 0.5) * 0x1.0p-32; }
    // Two independent uniforms from one draw.
    inline void uniforms(double& u1, double& u2) {
        const std::uint64_t x = next();
        u1 = u32(static_cast<std::uint32_t>(x >> 32));
        u2 = u32(static_cast<std::uint32_t>(x));
    }
};

// ----------------------------------------------------------------------------- fast normals

// Inverse normal CDF (Acklam's rational approximation, relative error < 1.2e-9). Only used to
// build the lookup table once.
double inv_norm_cdf(double p) {
    static const double a[] = {-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
                               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00};
    static const double b[] = {-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
                               6.680131188771972e+01, -1.328068155288572e+01};
    static const double c[] = {-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
                               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00};
    static const double d[] = {7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
                               3.754408661907416e+00};
    const double lo = 0.02425;
    if (p < lo) {
        const double q = std::sqrt(-2 * std::log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) return -inv_norm_cdf(1 - p);
    const double q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Normals by table lookup: 2^14 cells of the inverse CDF with linear interpolation. Each 32-bit
// half of a draw gives one normal (14 bits pick the cell, 18 bits interpolate). Tails are clipped
// at about +-3.8 sigma, which changes the variance by less than 0.1%: ample for spending noise,
// and 5x faster than Box-Muller's log/sqrt/sin/cos.
constexpr int kNormBits = 14;
constexpr int kNormCells = 1 << kNormBits;

struct NormalTable {
    double knot[kNormCells + 1];
    NormalTable() {
        for (int i = 0; i <= kNormCells; ++i) {
            const double u = std::min(std::max(static_cast<double>(i) / kNormCells, 0.5 / kNormCells),
                                      1.0 - 0.5 / kNormCells);
            knot[i] = inv_norm_cdf(u);
        }
    }
    inline double operator()(std::uint32_t x) const {
        const std::uint32_t i = x >> (32 - kNormBits);
        const double frac = static_cast<double>(x & ((1u << (32 - kNormBits)) - 1)) * 0x1.0p-18;
        return knot[i] + (knot[i + 1] - knot[i]) * frac;
    }
};
const NormalTable kNormal;

inline void normals(Xoshiro256Plus& rng, double& z1, double& z2) {
    const std::uint64_t x = rng.next();
    z1 = kNormal(static_cast<std::uint32_t>(x >> 32));
    z2 = kNormal(static_cast<std::uint32_t>(x));
}

// ----------------------------------------------------------------------------- one path

struct Scenario {
    double factor, inc_months, bills_pct, spend_delta, one_off, one_off_xs, ei_cap;
    bool noise, job_loss, forced;
    double ei_rate, ei_months_random, bills_growth, repair_rate, repair_lo, repair_hi;

    explicit Scenario(const double* k)
        : factor(k[K_FACTOR]), inc_months(k[K_INC_MONTHS]), bills_pct(k[K_BILLS_PCT]),
          spend_delta(k[K_SPEND_DELTA]), one_off(k[K_ONE_OFF]), one_off_xs(k[K_ONE_OFF_XS]),
          ei_cap(k[K_EI_CAP]), noise(k[K_NOISE] > 0), job_loss(k[K_JOB_LOSS] > 0), forced(k[K_FACTOR] != 1.0),
          ei_rate(k[K_EI_RATE]), ei_months_random(k[K_EI_MONTHS_RANDOM]), bills_growth(k[K_BILLS_GROWTH]),
          repair_rate(k[K_REPAIR_RATE]), repair_lo(k[K_REPAIR_LO]), repair_hi(k[K_REPAIR_HI]) {}
};

// Simulates one path. Returns the ruin time (inf if the balance never reaches 0 within `months`).
// If `balances` is not null it receives months + 1 balances.
inline double run_path(const double* p, const Scenario& sc, const double* growth_pow, int months,
                       Xoshiro256Plus& rng, double* balances) {
    const double I = p[P_I], S = p[P_S], H = p[P_H];
    const double in_scale = I > 0 ? p[P_SD_IN] / I : 0.0;
    const double out_scale = S > 0 ? p[P_SD_OUT] / S : 0.0;
    double forced_income = sc.factor * I;
    if (sc.factor < 1.0) forced_income = std::min(forced_income, sc.ei_cap);
    const double ei_income = std::min(sc.ei_rate * I, sc.ei_cap);

    double bal = p[P_B] - sc.one_off - sc.one_off_xs * S;
    double ruin = bal <= 0 ? 0.0 : kInf;
    bool employed = true;
    double ei_left = 0.0;
    if (balances) balances[0] = bal;

    for (int t = 0; t < months; ++t) {
        double u_job = 1.0, u_rep = 1.0;
        if ((sc.job_loss && !sc.forced) || sc.repair_rate > 0) rng.uniforms(u_job, u_rep);
        double income;
        if (sc.forced) {
            income = (sc.inc_months < 0 || t < sc.inc_months) ? forced_income : 0.0;
        } else {
            if (sc.job_loss && employed && u_job < p[P_JOB]) {
                employed = false;
                ei_left = sc.ei_months_random;
            }
            if (employed) {
                income = I;
            } else if (ei_left > 0) {
                income = ei_income;
                ei_left -= 1.0;
            } else {
                income = 0.0;
            }
        }
        double spend = S + sc.bills_pct * H * growth_pow[t] + sc.spend_delta;
        if (sc.noise) {
            double z1, z2;
            normals(rng, z1, z2);
            income = std::max(income * (1.0 + in_scale * z1), 0.0);
            spend = std::max(spend * (1.0 + out_scale * z2), 0.0);
        }
        if (sc.repair_rate > 0) {
            // One draw decides both whether a repair happens and (rescaled) how big it is.
            if (u_rep < sc.repair_rate)
                spend += (sc.repair_lo + (sc.repair_hi - sc.repair_lo) * (u_rep / sc.repair_rate)) * S;
        }
        const double next = bal + income - spend;
        if (ruin == kInf && next <= 0) ruin = t + bal / (bal - next);
        bal = next;
        if (balances) balances[t + 1] = bal;
    }
    return ruin;
}

std::vector<double> growth_table(const Scenario& sc, int months) {
    std::vector<double> g(static_cast<size_t>(std::max(months, 1)));
    for (int t = 0; t < months; ++t) g[t] = std::pow(1.0 + sc.bills_growth, t);
    return g;
}

// sorted[floor(q * (n - 1))], the same rule as numpy percentile(method="lower").
inline double lower_pct(std::vector<double>& v, double q) {
    const size_t k = static_cast<size_t>(std::floor(q * (v.size() - 1)));
    std::nth_element(v.begin(), v.begin() + k, v.end());
    return v[k];
}

void check_inputs(const arr& shock, int n_paths, int months) {
    if (shock.ndim() != 1 || shock.shape(0) != N_SHK)
        throw std::invalid_argument("shock must be a 1-D array of length " + std::to_string(N_SHK));
    if (n_paths < 1 || months < 1) throw std::invalid_argument("n_paths and months must be >= 1");
}

// Survival probability and median ruin for each account in [0, n) under one scenario.
void bank_core(const double* params, std::int64_t n, const double* shock, int n_paths, int months,
               std::uint64_t seed, double target, double* surv, double* med) {
    const Scenario sc(shock);
    const std::vector<double> g = growth_table(sc, months);
#pragma omp parallel
    {
        std::vector<double> ruin(static_cast<size_t>(n_paths));
#pragma omp for schedule(dynamic, 16)
        for (std::int64_t i = 0; i < n; ++i) {
            const double* p = params + i * N_PAR;
            int alive = 0;
            for (int j = 0; j < n_paths; ++j) {
                Xoshiro256Plus rng(seed, static_cast<std::uint64_t>(i), static_cast<std::uint64_t>(j));
                const double r = run_path(p, sc, g.data(), months, rng, nullptr);
                ruin[j] = r;
                alive += r >= target - kSurviveEps;
            }
            surv[i] = static_cast<double>(alive) / n_paths;
            med[i] = lower_pct(ruin, 0.5);
        }
    }
}

// ----------------------------------------------------------------------------- Python API

py::dict simulate_one(arr params, arr shock, int n_paths, int months, std::uint64_t seed, double target) {
    check_inputs(shock, n_paths, months);
    if (params.size() != N_PAR) throw std::invalid_argument("params must have 7 values");
    const double* p = params.data();
    const Scenario sc(shock.data());
    const std::vector<double> g = growth_table(sc, months);
    const int cols = months + 1;
    std::vector<double> bal(static_cast<size_t>(n_paths) * cols), ruin(static_cast<size_t>(n_paths));
    arr fan({3, cols});
    double survival, r10, r50, r90;
    {
        py::gil_scoped_release release;
        int alive = 0;
#pragma omp parallel for reduction(+ : alive) schedule(static)
        for (std::int64_t j = 0; j < n_paths; ++j) {
            Xoshiro256Plus rng(seed, 0, static_cast<std::uint64_t>(j));
            ruin[j] = run_path(p, sc, g.data(), months, rng, bal.data() + j * cols);
            alive += ruin[j] >= target - kSurviveEps;
        }
        survival = static_cast<double>(alive) / n_paths;
        double* f = fan.mutable_data();
#pragma omp parallel for schedule(static)
        for (std::int64_t t = 0; t < cols; ++t) {
            std::vector<double> col(static_cast<size_t>(n_paths));
            for (int j = 0; j < n_paths; ++j) col[j] = bal[static_cast<size_t>(j) * cols + t];
            f[t] = lower_pct(col, 0.10);
            f[cols + t] = lower_pct(col, 0.50);
            f[2 * cols + t] = lower_pct(col, 0.90);
        }
        r10 = lower_pct(ruin, 0.10);
        r50 = lower_pct(ruin, 0.50);
        r90 = lower_pct(ruin, 0.90);
    }
    py::dict out;
    out["survival"] = survival;
    out["ruin_p10"] = r10;
    out["ruin_p50"] = r50;
    out["ruin_p90"] = r90;
    out["fan"] = fan;
    return out;
}

py::tuple simulate_bank(arr params, arr shock, int n_paths, int months, std::uint64_t seed, double target) {
    check_inputs(shock, n_paths, months);
    if (params.ndim() != 2 || params.shape(1) != N_PAR) throw std::invalid_argument("params must be (n, 7)");
    const std::int64_t n = params.shape(0);
    arr surv(n), med(n);
    {
        py::gil_scoped_release release;
        bank_core(params.data(), n, shock.data(), n_paths, months, seed, target, surv.mutable_data(),
                  med.mutable_data());
    }
    return py::make_tuple(surv, med);
}

arr sweep(arr params, arr shocks, int n_paths, int months, std::uint64_t seed, double target) {
    if (params.ndim() != 2 || params.shape(1) != N_PAR) throw std::invalid_argument("params must be (n, 7)");
    if (shocks.ndim() != 2 || shocks.shape(1) != N_SHK)
        throw std::invalid_argument("shocks must be (m, " + std::to_string(N_SHK) + ")");
    if (n_paths < 1 || months < 1) throw std::invalid_argument("n_paths and months must be >= 1");
    const std::int64_t n = params.shape(0), m = shocks.shape(0);
    arr out({m, n});
    std::vector<double> med(static_cast<size_t>(n));
    {
        py::gil_scoped_release release;
        for (std::int64_t k = 0; k < m; ++k)
            bank_core(params.data(), n, shocks.data() + k * N_SHK, n_paths, months, seed + k, target,
                      out.mutable_data() + k * n, med.data());
    }
    return out;
}

int threads() { return omp_get_max_threads(); }
void set_threads(int n) { omp_set_num_threads(std::max(1, n)); }

double parallel_sum(arr values) {
    const double* v = values.data();
    const std::int64_t n = values.size();
    double total = 0.0;
    py::gil_scoped_release release;
#pragma omp parallel for reduction(+ : total) schedule(static)
    for (std::int64_t i = 0; i < n; ++i) total += v[i];
    return total;
}

}  // namespace

PYBIND11_MODULE(resil_hpc, m) {
    m.doc() = "C++ OpenMP Monte Carlo core for the Resilience Rewired engine";
    m.def("simulate_one", &simulate_one, py::arg("params"), py::arg("shock"), py::arg("n_paths") = 10000,
          py::arg("months") = 24, py::arg("seed") = 42, py::arg("target") = 6.0,
          "One customer: survival probability, ruin-time percentiles and the p10/p50/p90 balance fan");
    m.def("simulate_bank", &simulate_bank, py::arg("params"), py::arg("shock"), py::arg("n_paths") = 2000,
          py::arg("months") = 24, py::arg("seed") = 42, py::arg("target") = 6.0,
          "Every customer: (survival probability, median ruin time)");
    m.def("sweep", &sweep, py::arg("params"), py::arg("shocks"), py::arg("n_paths") = 500, py::arg("months") = 12,
          py::arg("seed") = 42, py::arg("target") = 6.0, "Survival probability for every (shock, customer) pair");
    m.def("threads", &threads, "Number of OpenMP threads available");
    m.def("set_threads", &set_threads, py::arg("n"), "Set the number of OpenMP threads");
    m.def("parallel_sum", &parallel_sum, py::arg("values"), "Sum a float64 array in parallel (toolchain check)");
    m.attr("__version__") = "0.3.0";
}
