import Register from './register.model.js';
import RegisterQuestion from './registerQuestion.model.js';
import Question from '../forms/question.model.js';

let initialized = false;

export function initRegisterModels() {
  if (initialized) return;

  Register.hasMany(RegisterQuestion, {
    foreignKey: 'register_id',
    as: 'register_questions',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  RegisterQuestion.belongsTo(Register, {
    foreignKey: 'register_id',
    as: 'register',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Question.hasMany(RegisterQuestion, {
    foreignKey: 'question_id',
    as: 'register_questions',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  RegisterQuestion.belongsTo(Question, {
    foreignKey: 'question_id',
    as: 'question',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });

  initialized = true;
}

export { Register, RegisterQuestion };
