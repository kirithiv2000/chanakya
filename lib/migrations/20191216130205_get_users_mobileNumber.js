exports.up = async (knex) => {
  const table = await knex.schema.table('users', (t) => {
    t.string('mobile', 10).after('id').nullable();
  });
  return table;
};

exports.down = async (knex) => {
  const dropTable = await knex.schema.table('users', (t) => {
    t.dropColumn('mobile');
  });
  return dropTable;
};
  