// Native Java script to decompile all functions in an imported binary via Headless Analyzer
// @category Decompiler

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.util.task.ConsoleTaskMonitor;
import java.io.FileWriter;
import java.io.PrintWriter;

public class decompile extends GhidraScript {
    @Override
    public void run() throws Exception {
        if (currentProgram == null) {
            println("[-] Error: No program loaded.");
            return;
        }

        println("[+] Loaded target program: " + currentProgram.getName());

        DecompInterface decompInterface = new DecompInterface();
        decompInterface.openProgram(currentProgram);

        FunctionIterator funcs = currentProgram.getFunctionManager().getFunctions(true);

        String outputFilePath = "decompiled_output.c";
        println("[+] Commencing decompilation. Output file: " + outputFilePath);

        int count = 0;
        try (PrintWriter writer = new PrintWriter(new FileWriter(outputFilePath))) {
            writer.println("/**");
            writer.println(" * Automatically decompiled using Ghidra Headless Analyzer (Java Engine)");
            writer.println(" * Target Binary: " + currentProgram.getName());
            writer.println(" */\n");

            while (funcs.hasNext() && !monitor.isCancelled()) {
                Function func = funcs.next();
                count++;
                writer.println("// =========================================");
                writer.println("// Function: " + func.getName() + " at 0x" + func.getEntryPoint());
                writer.println("// =========================================");

                // Decompile with a 30-second execution safety limit per function
                DecompileResults results = decompInterface.decompileFunction(func, 30, new ConsoleTaskMonitor());
                if (results.decompileCompleted()) {
                    String decompiledCode = results.getDecompiledFunction().getC();
                    if (decompiledCode != null && !decompiledCode.trim().isEmpty()) {
                        writer.println(decompiledCode);
                    } else {
                        writer.println("// [Warning] Decompilation succeeded but C output is empty.");
                    }
                } else {
                    writer.println("// [Error] Failed to decompile " + func.getName() + ": " + results.getErrorMessage());
                }
                writer.println("\n");
            }
        }

        println("[+] Decompilation process complete. Parsed " + count + " functions.");
    }
}
