exports.up = async (knex, Promise) => {
  await knex.schema.table('question_bucket_choices', (t) => {
    t.string('hiHelpText', 2000).nullable().after('questionIds').default(null);
    t.string('enHelpText', 2000).nullable().after('hiHelpText').default(null);
  });

  await knex.schema.createTable('topic_help_texts', (t) => {
    t.increments('id').notNullable();
    t.string('name').notNullable().unique();
    t.string('hiHelpText', 2000).nullable();
    t.string('enHelpText', 2000).nullable();
    t.datetime('createdAt').notNullable();
  });
};

exports.down = async (knex, Promise) => {
  await knex.schema.table('question_bucket_choices', (t) => {
    t.dropColumn('hiHelpText');
    t.dropColumn('enHelpText');
  });
  await knex.schema.dropTable('topic_help_texts');
};
