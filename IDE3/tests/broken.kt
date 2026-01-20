fun brokenKotlin() {
    val list = listOf(1, 2, 3)
    // Error: Malformed lambda structure
    list.forEach { 
}