falc\falc.exe vtextdemo.falc vtextdemo.bin

clang --target=wasm32 -emit-llvm -c -S fridge.c
clang --target=wasm32 -emit-llvm -c -S fridgemulib.c
clang --target=wasm32 -emit-llvm -c -S fridge_instance.c
llc -march=wasm32 -filetype=obj fridge.ll
llc -march=wasm32 -filetype=obj fridgemulib.ll
llc -march=wasm32 -filetype=obj fridge_instance.ll
wasm-ld --no-entry --export-all -o fridge.wasm fridge.o fridgemulib.o fridge_instance.o

::python -m http.server