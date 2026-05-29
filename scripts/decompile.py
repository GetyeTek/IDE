# Jython script to decompile all functions in an imported binary via Headless Analyzer
# @category Decompiler

from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
import os

def run():
    program = currentProgram
    if not program:
        print("[-] Error: No program loaded.")
        return

    print("[+] Loaded target program: %s" % program.getName())
    
    decomp_interface = DecompInterface()
    decomp_interface.openProgram(program)
    
    fm = program.getFunctionManager()
    funcs = fm.getFunctions(True) # True iterates functions in memory address order
    
    output_file_path = "decompiled_output.c"
    print("[+] Commencing decompilation. Output file: %s" % output_file_path)
    
    count = 0
    with open(output_file_path, "w") as f:
        f.write("/**\n")
        f.write(" * Automatically decompiled using Ghidra Headless Analyzer\n")
        f.write(" * Target Binary: %s\n" % program.getName())
        f.write(" */\n\n")
        
        for func in funcs:
            count += 1
            f.write("// =========================================\n")
            f.write("// Function: %s at 0x%s\n" % (func.getName(), func.getEntryPoint()))
            f.write("// =========================================\n")
            
            # Decompile each function with a 30-second execution safety limit
            results = decomp_interface.decompileFunction(func, 30, ConsoleTaskMonitor())
            if results.decompileCompleted():
                decompiled_code = results.getDecompiledFunction().getC()
                if decompiled_code:
                    f.write(decompiled_code)
                else:
                    f.write("// [Warning] Decompilation succeeded but C output is empty.\n")
            else:
                f.write("// [Error] Failed to decompile %s: %s\n" % (func.getName(), results.getErrorMessage()))
            f.write("\n\n")
            
    print("[+] Decompilation process complete. Parsed %d functions." % count)

if __name__ == "__main__":
    run()
