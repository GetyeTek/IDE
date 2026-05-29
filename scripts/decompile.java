// Native Java script to decompile functions in chunks of 500 and output to .txt files
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

        int chunkIndex = 1;
        int count = 0;
        PrintWriter writer = null;

        println("[+] Commencing chunked decompilation (500 functions per file)... ");

        try {
            while (funcs.hasNext() && !monitor.isCancelled()) {
                Function func = funcs.next();
                
                // Trigger file rotation at the start and after every 500 functions
                if (count % 500 == 0) {
                    if (writer != null) {
                        writer.close();
                    }
                    String fileName = "decompiled_chunk_" + chunkIndex + ".txt";
                    println("[+] Opening chunk file: " + fileName);
                    writer = new PrintWriter(new FileWriter(fileName));
                    writer.println("/**");
                    writer.println(" * Automatically decompiled using Ghidra Headless Analyzer (Java Engine)");
                    writer.println(" * Target Binary: " + currentProgram.getName());
                    writer.println(" * Chunk Index: " + chunkIndex);
                    writer.println(" */\n");
                    chunkIndex++;
                }

                count++;
                writer.println("// =========================================");
                writer.println("// Function: " + func.getName() + " at 0x" + func.getEntryPoint());
                writer.println("// =========================================");

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
        } finally {
            if (writer != null) {
                writer.close();
            }
        }

        println("[+] Decompilation process complete. Generated " + (chunkIndex - 1) + " .txt chunk files (Total: " + count + " functions).");
    }
}
