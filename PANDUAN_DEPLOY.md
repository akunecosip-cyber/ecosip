# Panduan Deploy ECOSIP ke Netlify

## Apa yang diperbaiki dari versi sebelumnya

1. **Backend hilang.** `index.html` memanggil `fetch('/api/ecosip')`, tapi tidak ada
   Netlify Function yang menanganinya — makanya daftar/masuk selalu gagal.
   Sudah dibuat: `netlify/functions/ecosip.js`.
2. **Struktur folder tidak cocok dengan `netlify.toml`.** File `publish = "public"`
   berarti Netlify mencari `index.html` di dalam folder `public/`. `index.html`
   sudah dipindahkan ke `public/index.html`.
3. **Tidak ada redirect `/api/*`.** Ditambahkan di `netlify.toml` supaya
   `/api/ecosip` diteruskan ke function `ecosip`.
4. **Data member tidak permanen.** Sekarang disimpan di **Netlify Blobs**
   (bawaan Netlify, tidak perlu database eksternal, tidak hilang saat function
   "tidur").
5. **Anti klik-ganda** ditambahkan di semua tombol daftar/masuk/kasir supaya
   tidak muncul error karena permintaan terkirim dua kali.

## Langkah deploy

1. Push seluruh folder ini (struktur di bawah) ke repo GitHub, atau upload
   langsung lewat drag-and-drop di **Netlify → Add new site → Deploy manually**.
   ```
   ecosip/
     netlify.toml
     package.json
     public/index.html
     public/manifest.json
     netlify/functions/ecosip.js
   ```
2. Di dashboard Netlify, buka **Site settings → Environment variables**, lalu
   tambahkan:
   | Key | Value |
   |---|---|
   | `SESSION_SECRET` | teks acak panjang, bebas (contoh: hasil `openssl rand -hex 32`) |
   | `CASHIER_USERNAME` | `kasir1` |
   | `CASHIER_PASSWORD` | *(lihat kredensial di chat — jangan dibagikan ke luar)* |

   Kalau nanti butuh lebih dari satu akun kasir, ganti dua baris terakhir
   dengan satu variabel `CASHIER_ACCOUNTS` berisi
   `kasir1:passwordA,kasir2:passwordB`.
3. **Trigger deploy** (atau tunggu auto-deploy kalau pakai GitHub). Netlify
   otomatis menjalankan `npm install` untuk memasang `@netlify/blobs`.
4. Setelah live, coba: daftar member baru → cek dashboard tampil saldo 0 →
   buka menu Kasir, login pakai kredensial di atas → cari No. HP yang baru
   didaftarkan → proses pembelian → saldo di dashboard member ikut bertambah.

## Kalau nanti kehabisan kredit lagi

Netlify Blobs dan Netlify Functions termasuk paket **gratis (Starter)** untuk
trafik skala warung/kafe kecil. Yang biasanya memakai kredit/biaya tambahan
adalah **build minutes** kalau sering push perubahan kecil berkali-kali, atau
kalau memakai layanan pihak ketiga berbayar. Proyek ini sengaja dibuat tanpa
database eksternal berbayar, jadi risikonya lebih kecil.

## Saran tambahan (opsional, boleh diminta dibuatkan kalau perlu)

- Ekspor riwayat transaksi member ke CSV dari panel kasir.
- Notifikasi WhatsApp otomatis ke member saat coin bertambah (perlu API pihak
  ketiga seperti Fonnte/WA Business API).
- Batasi percobaan login kasir yang gagal (mis. kunci 5 menit setelah 5x
  salah) untuk mencegah tebak-tebak password.
- Ganti tampilan riwayat jadi ada filter tanggal saat data sudah banyak.
