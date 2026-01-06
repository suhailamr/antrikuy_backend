const mongoose = require("mongoose");

const dissolveRequestSchema = new mongoose.Schema({
  school: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, required: true },
  evidence: { type: String, default: "" }, 
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" }
}, { timestamps: true });

module.exports = mongoose.model("DissolveRequest", dissolveRequestSchema);