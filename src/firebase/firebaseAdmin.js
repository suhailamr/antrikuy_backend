const admin = require('firebase-admin');

const rawKey = process.env.FIREBASE_ADMIN_KEY;

if (!rawKey) {
  console.error('❌ FIREBASE_ADMIN_KEY belum di-set di file .env');
  throw new Error('FIREBASE_ADMIN_KEY missing');
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(rawKey);
} catch (err) {
  console.error('❌ Gagal parse FIREBASE_ADMIN_KEY. Pastikan format JSON satu baris di .env benar.');
  throw err;
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log('✅ Firebase Admin berhasil di-inisialisasi');

module.exports = admin;
