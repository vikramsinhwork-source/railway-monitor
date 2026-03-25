import User from '../users/user.model.js';
import Form from './form.model.js';
import Question from './question.model.js';
import Submission from './submission.model.js';
import Answer from './answer.model.js';

let initialized = false;

export function initFormModels() {
  if (initialized) {
    return;
  }

  Form.hasMany(Question, { foreignKey: 'form_id', as: 'questions', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
  Question.belongsTo(Form, { foreignKey: 'form_id', as: 'form', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

  Form.hasMany(Submission, { foreignKey: 'form_id', as: 'submissions', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
  Submission.belongsTo(Form, { foreignKey: 'form_id', as: 'form', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

  User.hasMany(Submission, { foreignKey: 'user_id', as: 'submissions', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
  Submission.belongsTo(User, { foreignKey: 'user_id', as: 'user', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

  Submission.hasMany(Answer, { foreignKey: 'submission_id', as: 'answers', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
  Answer.belongsTo(Submission, { foreignKey: 'submission_id', as: 'submission', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

  Question.hasMany(Answer, { foreignKey: 'question_id', as: 'answers', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
  Answer.belongsTo(Question, { foreignKey: 'question_id', as: 'question', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

  initialized = true;
}

export { Form, Question, Submission, Answer };
