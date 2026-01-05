const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema({
  namaSekolah: {
    type: String,
    required: true,
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
    default: false,
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
});

const School = mongoose.model("School", schoolSchema);

module.exports = School;
