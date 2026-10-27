import { z, ref, out, crud, action, fail, listResult } from '../core/kit.js';

const archived = (r) => r.status === 'archived';

export default {
  id: 'companies',
  code: 'M02',
  title: 'Companies',
  description: 'Manage business accounts and linked contacts.',
  keywords: ['company', 'account', 'organization', 'business', 'b2b', 'firm'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create company',
      collection: 'companies',
      description: 'Create a company (business account) with name, domain, industry and size.',
      fields: {
        name: z.string().min(1),
        domain: z.string().optional(),
        industry: z.string().optional(),
        size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
      },
      validate(a, { db }) {
        if (db.findOne('companies', (c) => c.name.toLowerCase() === a.name.toLowerCase() && !archived(c)))
          throw fail.conflict(`Company "${a.name}" already exists`);
      },
      defaults: () => ({
        domain: null,
        industry: null,
        size: null,
        accountManagerId: null,
        status: 'active',
        tags: [],
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get company details',
      collection: 'companies',
      idField: 'companyId',
      description: 'Get a company by ID including its contact count and open opportunity value.',
      enrich: (c, { db }) => ({
        contactCount: db.find('contacts', (x) => x.companyId === c.id && x.status === 'active').length,
        openPipelineValue: db
          .find('opportunities', (o) => o.companyId === c.id && o.status === 'open')
          .reduce((a, o) => a + o.value, 0),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search companies',
      collection: 'companies',
      description: 'Search companies by name/domain text, industry, size or account manager.',
      text: ['name', 'domain'],
      filters: { industry: z.string(), size: z.string(), accountManagerId: ref('users') },
      hide: archived,
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update company details',
      collection: 'companies',
      idField: 'companyId',
      description: "Update a company's name, domain, industry or size.",
      fields: {
        name: z.string().min(1),
        domain: z.string(),
        industry: z.string(),
        size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']),
      },
      guard: (r) => {
        if (archived(r)) throw fail.state(`Company ${r.id} is archived`);
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'archive',
      title: 'Archive company',
      collection: 'companies',
      idField: 'companyId',
      from: ['active'],
      to: 'archived',
      effect: 'destructive',
      description: 'Archive a company account.',
    }),
    action({
      code: 'A06',
      name: 'link_contact',
      title: 'Link contact to company',
      effect: 'write',
      description: "Link a contact to a company (sets the contact's company).",
      input: z.object({ companyId: ref('companies'), contactId: ref('contacts') }),
      handler({ companyId, contactId }, { db, actor }) {
        const co = db.must('companies', companyId);
        if (archived(co)) throw fail.state(`Company ${co.name} is archived`);
        const c = db.must('contacts', contactId);
        if (c.companyId === companyId) throw fail.conflict(`${c.name} is already linked to ${co.name}`);
        return db.update('contacts', c.id, { companyId }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'unlink_contact',
      title: 'Unlink contact from company',
      effect: 'write',
      description: 'Remove the link between a contact and a company.',
      input: z.object({ companyId: ref('companies'), contactId: ref('contacts') }),
      handler({ companyId, contactId }, { db, actor }) {
        const c = db.must('contacts', contactId);
        db.must('companies', companyId);
        if (c.companyId !== companyId) throw fail.state(`${c.name} is not linked to company ${companyId}`);
        return db.update('contacts', c.id, { companyId: null }, actor);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'assign_account_manager',
      title: 'Assign account manager',
      collection: 'companies',
      idField: 'companyId',
      field: 'accountManagerId',
      schema: ref('users'),
      description: 'Assign a user as account manager for a company.',
      guard: (r, a, { db }) => {
        const u = db.must('users', a.accountManagerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    action({
      code: 'A09',
      name: 'merge_duplicates',
      title: 'Merge duplicate companies',
      effect: 'destructive',
      description:
        'Merge a duplicate company into a primary one, moving its contacts and opportunities, then archive the duplicate.',
      input: z.object({ primaryCompanyId: ref('companies'), duplicateCompanyId: ref('companies') }),
      output: out.shape({ id: z.string(), movedContacts: z.number(), movedOpportunities: z.number() }),
      handler({ primaryCompanyId, duplicateCompanyId }, { db, actor }) {
        if (primaryCompanyId === duplicateCompanyId)
          throw fail.validation('Cannot merge a company into itself');
        const p = db.must('companies', primaryCompanyId);
        const d = db.must('companies', duplicateCompanyId);
        if (archived(d)) throw fail.state(`Company ${d.name} is already archived`);
        const cs = db.find('contacts', (c) => c.companyId === d.id);
        cs.forEach((c) => db.update('contacts', c.id, { companyId: p.id }, actor));
        const os = db.find('opportunities', (o) => o.companyId === d.id);
        os.forEach((o) => db.update('opportunities', o.id, { companyId: p.id }, actor));
        db.update('companies', d.id, { status: 'archived', mergedInto: p.id }, actor);
        return { ...p, movedContacts: cs.length, movedOpportunities: os.length };
      },
    }),
    action({
      code: 'A10',
      name: 'list_contacts',
      title: 'List company contacts',
      effect: 'read',
      description: 'List the active contacts linked to a company.',
      input: z.object({ companyId: ref('companies') }),
      output: out.list,
      handler({ companyId }, { db }) {
        db.must('companies', companyId);
        return listResult(
          db.find('contacts', (c) => c.companyId === companyId && c.status === 'active'),
          200,
        );
      },
    }),
  ],
};
