// resil_hpc: C++17 + OpenMP simulation core, exposed to Python with pybind11.
//
// Phase 0 only proves the toolchain: the module builds, imports, and runs an
// OpenMP parallel loop. The Monte Carlo simulation is added in Phase 3b.

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <omp.h>

#include <cstdint>

namespace py = pybind11;

// Number of threads OpenMP will use for a parallel region.
static int threads() { return omp_get_max_threads(); }

// Parallel sum of a float64 array. Used as a smoke test that OpenMP and the
// zero-copy NumPy hand-off both work.
static double parallel_sum(py::array_t<double, py::array::c_style | py::array::forcecast> values) {
    const auto buf = values.unchecked<1>();
    const std::int64_t n = static_cast<std::int64_t>(buf.shape(0));
    double total = 0.0;
    {
        py::gil_scoped_release release;
        // Signed loop index: MSVC's OpenMP 2.0 requires it.
#pragma omp parallel for reduction(+ : total) schedule(static)
        for (std::int64_t i = 0; i < n; ++i) {
            total += buf(i);
        }
    }
    return total;
}

PYBIND11_MODULE(resil_hpc, m) {
    m.doc() = "C++ OpenMP simulation core for the Resilience Rewired engine";
    m.def("threads", &threads, "Number of OpenMP threads available");
    m.def("parallel_sum", &parallel_sum, py::arg("values"),
          "Sum a float64 array in parallel (toolchain smoke test)");
    m.attr("__version__") = "0.1.0";
}
