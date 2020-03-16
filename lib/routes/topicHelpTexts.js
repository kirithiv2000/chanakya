const TopicHelpText = require('../models/topicHelpText');

module.exports = [
  {
    method: 'GET',
    path: '/questions/topicHelpTexts',
    options: {
      description: 'Returns a list of all help texts associated with every topic stored in the DB.',
      tags: ['api'],
      handler: async (request) => {
        const { topicHelpTextService } = request.services();
        const helpTexts = await topicHelpTextService.findAll();

        return { helpTexts };
      },
    }
  },
  {
    method: 'PUT',
    path: '/questions/topicHelpTexts/{topicName}',
    options: {
      description: 'If a topic with the name exists then updates it otherwise creates it with the given help texts.',
      tags: ['api'],
      validate: {
        params: {
          topicName: TopicHelpText.field('name')
        },
        payload: {
          enHelpText: TopicHelpText.field('enHelpText'),
          hiHelpText: TopicHelpText.field('hiHelpText'),
        },
      },
      handler: async (request) => {
        const { topicHelpTextService } = request.services();

        const { topicName } = request.params;
        const helpText = await topicHelpTextService.createOrUpdate(topicName, request.payload);

        return { helpText }
      },
    }
  }
]; 


