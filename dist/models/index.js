"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalSettingsModel = exports.GlobalSettingsSchema = exports.BroadcastModel = exports.BroadcastSchema = exports.JoinRequestModel = exports.JoinRequestSchema = exports.UserModel = exports.UserSchema = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
// --- User ---
exports.UserSchema = new mongoose_1.default.Schema({
    tgId: { type: Number, required: true, unique: true },
    firstName: String,
    lastName: String,
    username: String,
    isAdmin: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
});
exports.UserModel = mongoose_1.default.models.User || mongoose_1.default.model("User", exports.UserSchema);
// --- Join Request ---
exports.JoinRequestSchema = new mongoose_1.default.Schema({
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
exports.JoinRequestSchema.index({ status: 1 });
exports.JoinRequestSchema.index({ userId: 1, status: 1 });
exports.JoinRequestModel = mongoose_1.default.models.JoinRequest ||
    mongoose_1.default.model("JoinRequest", exports.JoinRequestSchema);
// --- Broadcast ---
exports.BroadcastSchema = new mongoose_1.default.Schema({
    messageId: { type: String, required: true, unique: true },
    text: String,
    sentAt: { type: Date, default: Date.now },
    totalTargeted: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
});
exports.BroadcastModel = mongoose_1.default.models.Broadcast ||
    mongoose_1.default.model("Broadcast", exports.BroadcastSchema);
// Global Settings ---
exports.GlobalSettingsSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose_1.default.Schema.Types.Mixed },
});
exports.GlobalSettingsModel = mongoose_1.default.models.GlobalSettings ||
    mongoose_1.default.model("GlobalSettings", exports.GlobalSettingsSchema);
