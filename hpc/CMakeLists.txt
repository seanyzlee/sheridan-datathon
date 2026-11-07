cmake_minimum_required(VERSION 3.26)
project(resil_hpc LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PYBIND11_FINDPYTHON ON)
find_package(pybind11 CONFIG REQUIRED)
find_package(OpenMP REQUIRED COMPONENTS CXX)

pybind11_add_module(resil_hpc src/resil.cpp)
target_link_libraries(resil_hpc PRIVATE OpenMP::OpenMP_CXX)

if(MSVC)
  target_compile_options(resil_hpc PRIVATE /O2 /Oi /fp:fast /arch:AVX2 /W3 /EHsc)
else()
  target_compile_options(resil_hpc PRIVATE -O3 -march=native -ffast-math -Wall)
endif()

install(TARGETS resil_hpc LIBRARY DESTINATION .)
