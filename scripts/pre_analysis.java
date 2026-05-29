// Disable verbose and crash-prone exception handlers during analysis
// @category Analysis

import ghidra.app.script.GhidraScript;

public class pre_analysis extends GhidraScript {
    @Override
    public void run() throws Exception {
        println("[+] Pre-analysis: Disabling verbose GCC Exception Handlers analyzer...");
        
        // Disable GCC Exception Handlers to stop LSDACallSiteTable logs and invalid disassembly attempts
        setAnalysisOption(currentProgram, "GCC Exception Handlers", "false");
        
        println("[+] Pre-analysis: GCC Exception Handlers analyzer successfully disabled.");
    }
}
