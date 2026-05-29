# Programmatic pre-analysis configuration to disable verbose and error-prone analyzers
# @category Analysis

def run():
    print("[+] Pre-analysis: Disabling verbose GCC Exception Handlers analyzer...")
    
    # Disable 'GCC Exception Handlers' to avoid parsing invalid exception tables and log flooding
    setAnalysisOption(currentProgram, "GCC Exception Handlers", "false")
    
    print("[+] Pre-analysis: Configuration successfully applied.")

if __name__ == "__main__":
    run()
