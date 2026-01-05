const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MONGODB_URI belum diset di file .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('✅ Terhubung ke MongoDB Atlas');
  } catch (error) {
    console.error('❌ Gagal terhubung ke MongoDB:', error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
