#include "fridgemulib.h"

FRIDGE_SYSTEM sys;
FRIDGE_CPU cpu;
FRIDGE_GPU gpu;
FRIDGE_ROM rom;
FRIDGE_KEYBOARD_CONTROLLER kbrd;

void fridge_init()
{
     sys.cpu = &cpu;
     sys.gpu = &gpu;
     sys.rom = &rom;
     sys.kbrd = &kbrd;
     FRIDGE_cpu_reset(&cpu);
     FRIDGE_gpu_reset(&gpu);
}

void fridge_tick(int cycles)
{
    for (int i = 0; i < cycles; ++i)
        FRIDGE_sys_tick(&sys);
}

FRIDGE_WORD fridge_read_vmem(int addr)
{
    //if (sys.gpu->)
    //return sys.gpu->frame_a[addr];
    return FRIDGE_gpu_visible_frame(&gpu)[addr];
}

void* fridge_get_ramptr()
{
    return cpu.ram;
}

FRIDGE_WORD fridge_get_PC()
{
    return cpu.ram[cpu.PC];
}

FRIDGE_WORD fridge_get_palette(int index)
{
    if (index >= 0 && index < FRIDGE_GPU_PALETTE_SIZE)
        return gpu.palette[index];
    return 0;
}