'use strict';

const Schmervice = require('schmervice');

module.exports = class TopicHelpTextService extends Schmervice.Service {
  async findAll(txn) {
    const { TopicHelpText } = this.server.models();
    const topicHelpTexts = await TopicHelpText.query(txn);
    return topicHelpTexts;
  }

  async createOrUpdate(name, helpText, txn = null) {
    const { TopicHelpText } = this.server.models();
    let topicHelpText = await TopicHelpText.query(txn).where({ name: name }).first();

    if (topicHelpText) { // if exists then update the record
      await TopicHelpText.query(txn).patch({...helpText}).where({ id: topicHelpText.id });
    } else { // otherwise create a new record
      topicHelpText = await TopicHelpText.query(txn).insert({ name, ...helpText});
    }

    return topicHelpText;
  }
};
