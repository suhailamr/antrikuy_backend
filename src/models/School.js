const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema({
  namaSekolah: {
    type: String,
    required: true,
    trim: true,
  },
  // 🔥 TAMBAHKAN NPSN DISINI
  npsn: {
    type: String,
    required: true,
    unique: true, // NPSN tidak boleh kembar antar sekolah
    trim: true,
  },
  alamat: {
    type: String,
    trim: true,
  },
  kodeAksesStatis: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  penyediaAntrian: {
    type: Boolean,
    default: false, // Default false agar masuk ke tab PENDING di Super Admin
  },
  dibuatPada: {
    type: Date,
    default: Date.now,
  },
  idSekolah: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  deskripsi: {
    type: String,
    trim: true,
  },
  kategoriSekolah: {
    type: String,
    enum: ["SD", "SMP", "SMA", "SMK"],
    required: true,
  },
  fotoUrl: {
    type: String,
    default: null,
  },
  lokasiMaps: {
    lat: { type: Number },
    lng: { type: Number },
  },
  // 🔥 TAMBAHKAN createdBy DISINI (SANGAT PENTING)
  // Ini untuk menyimpan ID user pengaju agar Super Admin tahu siapa yang daftar
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Mengacu pada model User
    required: true,
  },
});

const School = mongoose.model("School", schoolSchema);

module.exports = School;