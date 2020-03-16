const Schwifty = require('schwifty');
const Joi = require('joi');

const { Model } = require('./helpers');

module.exports = class TopicHelpText extends Model {
  static get tableName() {
    return 'topic_help_texts';
  }

  static get joiSchema() {
    return Joi.object({
      id: Joi.number().integer().greater(0),
      name: Joi.string().required(),
      hiHelpText: Joi.string().required().allow(null),
      enHelpText: Joi.string().required().allow(null),
      createdAt: Joi.date(),
    });
  }

  $beforeInsert() {
    const now = new Date();
    this.createdAt = now;
  }
};
