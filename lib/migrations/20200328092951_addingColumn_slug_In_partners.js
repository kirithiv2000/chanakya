
exports.up = async (knex) => {
  await knex.schema.table('partners', (t) => {
    t.string('slug').after('notes').notNullable().unique();
  });
};

exports.down = async (knex) => {
  await knex.schema.table('partners', (t) => {
    t.dropColumn('slug');
  });
};