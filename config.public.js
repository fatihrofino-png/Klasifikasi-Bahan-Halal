/* Konfigurasi publik Fase 2 — website Klasifikasi Bahan Halal BPJPH.
   File ini BOLEH dibaca browser: hanya berisi URL proyek Supabase dan
   anon key (publishable key) yang memang dirancang untuk dipakai di client.
   JANGAN PERNAH menulis service key atau kunci LLM server di file ini —
   kunci-kunci itu hanya ada sebagai Environment Variable di server
   (Vercel). Isi nilai di bawah ini setelah proyek Supabase dibuat
   (Tiket 11d); selama masih kosong, fitur login & analisis AI menampilkan
   pesan jujur "layanan login belum dikonfigurasi" dan pencarian Fase 1
   tetap jalan tanpa login. */
window.FASE2_CONFIG = {
  supabaseUrl: "https://rifmzgzvhvrofvtimbvz.supabase.co",
  supabaseAnonKey: "sb_publishable_Xfc2P8fhFA2IQBYL1o4XgA_iBh_11ty"
};
