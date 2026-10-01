import mongoose from '../config/mongoose.js';

const { Schema } = mongoose;

// A book that readers are required to read, optionally by a due date.
const assignmentSchema = new Schema(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    note: { type: String, trim: true, maxlength: 2000, default: '' },
    dueDate: Date,
    // everyone = all readers (including people who join later); otherwise only `users`.
    everyone: { type: Boolean, default: true },
    users: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

assignmentSchema.index({ users: 1 });

export const Assignment = mongoose.model('Assignment', assignmentSchema);
