import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  faces: [
    {
      label: String,
      descriptions: Array,
    },
  ],
});

export const User = mongoose.model("user", userSchema);
