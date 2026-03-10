import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const FOLDERS = ['freq_4', 'freq_5', 'freq_6', 'freq_7', 'freq_8', 'freq_9', 'freq_10', 'freq_11', 'freq_12', 'freq_13', 'freq_14', 'freq_15', 'freq_16', 'freq_17', 'freq_18', 'freq_19', 'freq_20', 'freq_21', 'freq_22', 'freq_23', 'freq_24', 'freq_25', 'freq_26', 'freq_27', 'freq_28', 'freq_29', 'freq_30', 'freq_31', 'freq_32', 'freq_33', 'freq_34', 'freq_35', 'freq_36', 'freq_37', 'freq_38', 'freq_39', 'freq_40', 'freq_41', 'freq_42', 'freq_43', 'freq_44', 'freq_45', 'freq_46', 'freq_47', 'freq_48', 'freq_49', 'freq_50', 'freq_51', 'freq_52', 'freq_53', 'freq_54', 'freq_55', 'freq_56', 'freq_57', 'freq_58', 'freq_59', 'freq_60', 'freq_61', 'freq_62', 'freq_63', 'freq_64', 'freq_65', 'freq_66', 'freq_67', 'freq_68', 'freq_69', 'freq_70', 'freq_71', 'freq_72', 'freq_73', 'freq_74', 'freq_75', 'freq_76', 'freq_77', 'freq_78', 'freq_79', 'freq_80', 'freq_81', 'freq_82', 'freq_83', 'freq_84', 'freq_85', 'freq_86', 'freq_87', 'freq_88', 'freq_89', 'freq_90', 'freq_91', 'freq_92', 'freq_93', 'freq_94', 'freq_95', 'freq_96', 'freq_97', 'freq_98', 'freq_99', 'freq_100', 'freq_101', 'freq_102', 'freq_103', 'freq_104', 'freq_105', 'freq_106', 'freq_107', 'freq_108', 'freq_109', 'freq_110', 'freq_111', 'freq_112', 'freq_113', 'freq_114', 'freq_115', 'freq_116', 'freq_117', 'freq_118', 'freq_119', 'freq_120', 'freq_121', 'freq_122', 'freq_123', 'freq_124', 'freq_125', 'freq_126', 'freq_127', 'freq_128', 'freq_129', 'freq_130', 'freq_131', 'freq_132', 'freq_133', 'freq_134', 'freq_135', 'freq_136', 'freq_137', 'freq_138', 'freq_139', 'freq_140', 'freq_141', 'freq_142', 'freq_143', 'freq_144', 'freq_145', 'freq_146', 'freq_147', 'freq_148', 'freq_149', 'freq_150', 'freq_151', 'freq_152', 'freq_153', 'freq_154', 'freq_155', 'freq_157', 'freq_158', 'freq_160', 'freq_162', 'freq_165', 'freq_167', 'freq_169', 'freq_171', 'freq_172', 'freq_174', 'freq_176', 'freq_181', 'freq_182', 'freq_197'];

async function discoverUnionFiles() {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  console.log('--- STARTING UNION DISCOVERY ---');

  for (const folder of FOLDERS) {
    const path = `union/${folder}`;
    const { data: files, error } = await supabase.storage.from('V2').list(path);

    if (error) {
      console.error(`Error listing ${path}:`, error.message);
      continue;
    }

    if (!files || files.length === 0) continue;

    const insertData = files
      .filter(f => f.name.endsWith('.txt'))
      .map(f => ({
        folder_name: folder,
        file_path: `${path}/${f.name}`,
        status: 'pending'
      }));

    const { error: insertErr } = await supabase
      .from('union_refinery_queue')
      .upsert(insertData, { onConflict: 'file_path' });

    if (insertErr) console.error(`Error inserting ${folder}:`, insertErr.message);
    else console.log(`Discovered ${files.length} files in ${folder}`);
  }
}

discoverUnionFiles();