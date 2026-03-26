const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function populate() {
    const soDir = path.join(process.cwd(), 'So');
    if (!fs.existsSync(soDir)) {
        console.error('So folder not found!');
        process.exit(1);
    }

    const files = fs.readdirSync(soDir).filter(f => f.endsWith('.so'));
    console.log(`Found ${files.length} .so files. Inserting into DB...`);

    for (const file of files) {
        const { error } = await supabase
            .from('so_analysis')
            .upsert({ file_path: file }, { onConflict: 'file_path' });
        
        if (error) console.error(`Error adding ${file}:`, error.message);
        else console.log(`Added: ${file}`);
    }
}

populate();