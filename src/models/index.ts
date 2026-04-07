import mongoose from "mongoose";

// --- User ---
export const UserSchema = new mongoose.Schema({
  tgId: { type: Number, required: true, unique: true },
  firstName: String,
  lastName: String,
  username: String,
  isAdmin: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
});

export const UserModel =
  mongoose.models.User || mongoose.model("User", UserSchema);

// --- Join Request ---
export const JoinRequestSchema = new mongoose.Schema({
  chatId: { type: Number, required: true },
  userId: { type: Number, required: true, index: true },
  firstName: String,
  lastName: String,
  username: String,
  autoApproved: { type: Boolean, default: true },
  approvedBy: { type: Number },
  status: { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
  adminMessageId: { type: Number },
  adminChatId: { type: Number },
  requestedAt: { type: Date, default: Date.now },
  actionAt: Date,
});

JoinRequestSchema.index({ status: 1 });
JoinRequestSchema.index({ userId: 1, status: 1 });

export const JoinRequestModel =
  mongoose.models.JoinRequest ||
  mongoose.model("JoinRequest", JoinRequestSchema);

// --- Broadcast ---
export const BroadcastSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  text: String,
  sentAt: { type: Date, default: Date.now },
  totalTargeted: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
});

export const BroadcastModel =
  mongoose.models.Broadcast ||
  mongoose.model("Broadcast", BroadcastSchema);

// Global Settings ---
export const GlobalSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
});

export const GlobalSettingsModel =
  mongoose.models.GlobalSettings ||
  mongoose.model("GlobalSettings", GlobalSettingsSchema);
