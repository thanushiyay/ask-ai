# Module and action catalog

50 modules, 500 actions. Generated from the registry (`npm run catalog`). Effects: **read** (no changes), **write** (changes data), **destructive** (archives, cancels or deletes — confirmed first), **external** (visible to customers or the public — confirmed first).

## M01 Contacts (`contacts`)

Manage people and their CRM profiles.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M01.A01 | Create contact | write | `contacts.create(firstName*: string, lastName: string, email: email, phone: string, companyId: id<companies>, ownerId: id<users>, tags: string[], source: string)` |
| M01.A02 | Get contact details | read | `contacts.get(contactId*: id<contacts>)` |
| M01.A03 | Search contacts | read | `contacts.search(query: string, ids: string[], ownerId: id<users>, companyId: id<companies>, tags: string, source: string, status: active\|archived, ownerIds: string[], companyIds: string[], createdFrom: date-time, createdTo: date-time, unowned: boolean, includeArchived: boolean, limit: integer)` |
| M01.A04 | Update contact details | write | `contacts.update(contactId*: id<contacts>, firstName: string, lastName: string, email: email, phone: string, companyId: id<companies>, source: string)` |
| M01.A05 | Archive contact | destructive | `contacts.archive(contactId*: id<contacts>)` |
| M01.A06 | Merge duplicate contacts | destructive | `contacts.merge_duplicates(primaryContactId*: id<contacts>, duplicateContactId*: id<contacts>)` |
| M01.A07 | Assign contact owner | write | `contacts.assign_owner(contactId*: id<contacts>, ownerId*: id<users>)` |
| M01.A08 | Set communication preferences | write | `contacts.set_communication_preferences(contactId*: id<contacts>, email: subscribed\|unsubscribed, sms: opted_in\|opted_out, preferredChannel: email\|sms\|phone, doNotContact: boolean)` |
| M01.A09 | Add contact relationship | write | `contacts.add_relationship(contactId*: id<contacts>, relatedContactId*: id<contacts>, type*: spouse\|colleague\|assistant\|manager\|referred_by\|family\|other)` |
| M01.A10 | View contact activity timeline | read | `contacts.activity_timeline(contactId*: id<contacts>, limit: integer)` |

## M02 Companies (`companies`)

Manage business accounts and linked contacts.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M02.A01 | Create company | write | `companies.create(name*: string, domain: string, industry: string, size: 1-10\|11-50\|51-200\|201-1000\|1000+)` |
| M02.A02 | Get company details | read | `companies.get(companyId*: id<companies>)` |
| M02.A03 | Search companies | read | `companies.search(query: string, ids: string[], industry: string, size: string, accountManagerId: id<users>, accountManagerIds: string[], createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M02.A04 | Update company details | write | `companies.update(companyId*: id<companies>, name: string, domain: string, industry: string, size: 1-10\|11-50\|51-200\|201-1000\|1000+)` |
| M02.A05 | Archive company | destructive | `companies.archive(companyId*: id<companies>)` |
| M02.A06 | Link contact to company | write | `companies.link_contact(companyId*: id<companies>, contactId*: id<contacts>)` |
| M02.A07 | Unlink contact from company | write | `companies.unlink_contact(companyId*: id<companies>, contactId*: id<contacts>)` |
| M02.A08 | Assign account manager | write | `companies.assign_account_manager(companyId*: id<companies>, accountManagerId*: id<users>)` |
| M02.A09 | Merge duplicate companies | destructive | `companies.merge_duplicates(primaryCompanyId*: id<companies>, duplicateCompanyId*: id<companies>)` |
| M02.A10 | List company contacts | read | `companies.list_contacts(companyId*: id<companies>)` |

## M03 Leads (`leads`)

Capture, qualify, and route prospective customers.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M03.A01 | Create lead | write | `leads.create(contactId: id<contacts>, name: string, email: email, phone: string, source: facebook\|google_ads\|website\|referral\|webinar\|manual\|other, campaignId: id<campaigns>, ownerId: id<users>)` |
| M03.A02 | Get lead details | read | `leads.get(leadId*: id<leads>)` |
| M03.A03 | Search leads | read | `leads.search(query: string, ids: string[], status: new\|contacted\|qualified\|disqualified\|converted\|new\|contacted\|qualified\|disqualified\|converted[], source: facebook\|google_ads\|website\|referral\|webinar\|manual\|other\|facebook\|google_ads\|website\|referral\|webinar\|manual\|other[], campaignId: id<campaigns>, ownerId: id<users>, contactId: id<contacts>, campaignIds: string[], ownerIds: string[], contactIds: string[], createdFrom: date-time, createdTo: date-time, unassigned: boolean, minScore: number, limit: integer)` |
| M03.A04 | Update lead details | write | `leads.update(leadId*: id<leads>, name: string, email: email, phone: string, status: new\|contacted\|qualified)` |
| M03.A05 | Assign lead owner | write | `leads.assign_owner(leadId*: id<leads>, ownerId*: id<users>)` |
| M03.A06 | Set lead source | write | `leads.set_source(leadId*: id<leads>, source*: facebook\|google_ads\|website\|referral\|webinar\|manual\|other)` |
| M03.A07 | Record qualification answers | write | `leads.record_qualification(leadId*: id<leads>, budget: boolean, authority: boolean, need: boolean, timeline: this_month\|this_quarter\|next_year\|unknown, notes: string)` |
| M03.A08 | Update lead score | write | `leads.update_score(leadId*: id<leads>, score*: integer)` |
| M03.A09 | Disqualify lead with reason | destructive | `leads.disqualify(leadId*: id<leads>, reason*: string)` |
| M03.A10 | Convert lead to opportunity | write | `leads.convert_to_opportunity(leadId*: id<leads>, pipelineId: id<pipelines>, value: number, name: string)` |

## M04 Opportunities (`opportunities`)

Track individual deals through the sales process.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M04.A01 | Create opportunity | write | `opportunities.create(name*: string, contactId*: id<contacts>, pipelineId*: id<pipelines>, stageId: string, value: number, ownerId: id<users>, expectedCloseDate: date)` |
| M04.A02 | Get opportunity details | read | `opportunities.get(opportunityId*: id<opportunities>)` |
| M04.A03 | Search opportunities | read | `opportunities.search(query: string, ids: string[], status: open\|won\|lost, pipelineId: id<pipelines>, stageId: string, ownerId: id<users>, contactId: id<contacts>, companyId: id<companies>, pipelineIds: string[], stageIds: string[], ownerIds: string[], contactIds: string[], companyIds: string[], createdFrom: date-time, createdTo: date-time, closeDateFrom: date-time, closeDateTo: date-time, minValue: number, maxValue: number, limit: integer)` |
| M04.A04 | Update opportunity value | write | `opportunities.update_value(opportunityId*: id<opportunities>, value*: number)` |
| M04.A05 | Move opportunity to stage | write | `opportunities.move_stage(opportunityId*: id<opportunities>, stage*: string)` |
| M04.A06 | Assign opportunity owner | write | `opportunities.assign_owner(opportunityId*: id<opportunities>, ownerId*: id<users>)` |
| M04.A07 | Set expected close date | write | `opportunities.set_close_date(opportunityId*: id<opportunities>, expectedCloseDate*: date)` |
| M04.A08 | Mark opportunity won | write | `opportunities.mark_won(opportunityId*: id<opportunities>)` |
| M04.A09 | Mark opportunity lost | write | `opportunities.mark_lost(opportunityId*: id<opportunities>, reason: string)` |
| M04.A10 | Reopen closed opportunity | write | `opportunities.reopen(opportunityId*: id<opportunities>)` |

## M05 Pipelines (`pipelines`)

Configure the stages and rules for sales pipelines.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M05.A01 | Create pipeline | write | `pipelines.create(name*: string, stageNames: string[])` |
| M05.A02 | Get pipeline configuration | read | `pipelines.get(pipelineId*: id<pipelines>)` |
| M05.A03 | List pipelines | read | `pipelines.list(query: string, ids: string[], createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M05.A04 | Rename pipeline | write | `pipelines.rename(pipelineId*: id<pipelines>, name*: string)` |
| M05.A05 | Archive pipeline | destructive | `pipelines.archive(pipelineId*: id<pipelines>)` |
| M05.A06 | Add pipeline stage | write | `pipelines.add_stage(pipelineId*: id<pipelines>, name*: string, position: integer, winProbability: number)` |
| M05.A07 | Rename pipeline stage | write | `pipelines.rename_stage(pipelineId*: id<pipelines>, stageId*: string, name*: string)` |
| M05.A08 | Reorder pipeline stages | write | `pipelines.reorder_stages(pipelineId*: id<pipelines>, stageIds*: string[])` |
| M05.A09 | Remove empty pipeline stage | destructive | `pipelines.remove_empty_stage(pipelineId*: id<pipelines>, stageId*: string)` |
| M05.A10 | Set stage win probability | write | `pipelines.set_stage_probability(pipelineId*: id<pipelines>, stageId*: string, winProbability*: number)` |

## M06 Tasks (`tasks`)

Organize work, deadlines, and assignments.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M06.A01 | Create task | write | `tasks.create(title*: string, description: string, contactId: id<contacts>, leadId: id<leads>, opportunityId: id<opportunities>, ownerId: id<users>, dueDate: date-time, priority: low\|medium\|high\|urgent, type: general\|follow_up\|call\|email\|meeting\|todo)` |
| M06.A02 | Get task details | read | `tasks.get(taskId*: id<tasks>)` |
| M06.A03 | Search tasks | read | `tasks.search(query: string, ids: string[], status: open\|completed\|cancelled\|open\|completed\|cancelled[], ownerId: id<users>, contactId: id<contacts>, priority: low\|medium\|high\|urgent, type: general\|follow_up\|call\|email\|meeting\|todo, ownerIds: string[], createdFrom: date-time, createdTo: date-time, dueFrom: date-time, dueTo: date-time, overdue: boolean, leadId: id<leads>, leadIds: string[], contactIds: string[], limit: integer)` |
| M06.A04 | Update task description | write | `tasks.update_description(taskId*: id<tasks>, title: string, description: string)` |
| M06.A05 | Assign task owner | write | `tasks.assign_owner(taskId*: id<tasks>, ownerId*: id<users>)` |
| M06.A06 | Set task due date | write | `tasks.set_due_date(taskId*: id<tasks>, dueDate*: date-time)` |
| M06.A07 | Set task priority | write | `tasks.set_priority(taskId*: id<tasks>, priority*: low\|medium\|high\|urgent)` |
| M06.A08 | Mark task complete | write | `tasks.complete(taskId*: id<tasks>)` |
| M06.A09 | Reopen task | write | `tasks.reopen(taskId*: id<tasks>)` |
| M06.A10 | Cancel task | destructive | `tasks.cancel(taskId*: id<tasks>, reason: string)` |

## M07 Notes (`notes`)

Attach contextual notes to business records.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M07.A01 | Create note | write | `notes.create(body*: string, recordType: contact\|company\|lead\|opportunity\|ticket\|task\|invoice\|appointment\|order, recordId: string, pinned: boolean)` |
| M07.A02 | Get note | read | `notes.get(noteId*: id<notes>)` |
| M07.A03 | Search notes | read | `notes.search(query: string, ids: string[], pinned: boolean, createdFrom: date-time, createdTo: date-time, recordId: string, includeArchived: boolean, limit: integer)` |
| M07.A04 | Update note | write | `notes.update(noteId*: id<notes>, body*: string)` |
| M07.A05 | Delete note | destructive | `notes.delete(noteId*: id<notes>)` |
| M07.A06 | Attach note to record | write | `notes.attach(noteId*: id<notes>, recordType*: contact\|company\|lead\|opportunity\|ticket\|task\|invoice\|appointment\|order, recordId*: string)` |
| M07.A07 | Detach note from record | write | `notes.detach(noteId*: id<notes>, recordId*: string)` |
| M07.A08 | Pin note | write | `notes.pin(noteId*: id<notes>, pinned: boolean)` |
| M07.A09 | Unpin note | write | `notes.unpin(noteId*: id<notes>, pinned: boolean)` |
| M07.A10 | View note revision history | read | `notes.revision_history(noteId*: id<notes>)` |

## M08 Tags (`tags`)

Maintain labels and apply them to records.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M08.A01 | Create tag | write | `tags.create(name*: string, color: string)` |
| M08.A02 | List tags | read | `tags.list(query: string, ids: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M08.A03 | Rename tag | write | `tags.rename(tagId*: id<tags>, name*: string)` |
| M08.A04 | Set tag color | write | `tags.set_color(tagId*: id<tags>, color*: string)` |
| M08.A05 | Delete unused tag | destructive | `tags.delete_unused(tagId*: id<tags>)` |
| M08.A06 | Apply tag to record | write | `tags.apply(tag*: string, recordType*: contact\|lead\|company\|opportunity\|ticket, recordId*: string)` |
| M08.A07 | Remove tag from record | write | `tags.remove(tag*: string, recordType*: contact\|lead\|company\|opportunity\|ticket, recordId*: string)` |
| M08.A08 | List records with tag | read | `tags.list_records(tag*: string, recordType: contact\|lead\|company\|opportunity\|ticket, limit: integer)` |
| M08.A09 | Merge tags | destructive | `tags.merge(sourceTagId*: id<tags>, targetTagId*: id<tags>)` |
| M08.A10 | View tag usage counts | read | `tags.usage_counts(tag: string)` |

## M09 Smart Lists (`smart_lists`)

Define dynamic audiences using saved filters.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M09.A01 | Create smart list | write | `smart_lists.create(name*: string, module*: contacts\|leads\|companies\|opportunities\|tickets, rules*: {field,op,value}[])` |
| M09.A02 | Get smart list definition | read | `smart_lists.get(smartListId*: id<smart_lists>)` |
| M09.A03 | List smart lists | read | `smart_lists.list(query: string, ids: string[], module: contacts\|leads\|companies\|opportunities\|tickets, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M09.A04 | Rename smart list | write | `smart_lists.rename(smartListId*: id<smart_lists>, name*: string)` |
| M09.A05 | Update filter rules | write | `smart_lists.update_rules(smartListId*: id<smart_lists>, rules*: {field,op,value}[])` |
| M09.A06 | Preview matching records | read | `smart_lists.preview(smartListId*: id<smart_lists>, limit: integer)` |
| M09.A07 | Count matching records | read | `smart_lists.count(smartListId*: id<smart_lists>)` |
| M09.A08 | Export matching records | write | `smart_lists.export(smartListId*: id<smart_lists>, fields: string[])` |
| M09.A09 | Duplicate smart list | write | `smart_lists.duplicate(smartListId*: id<smart_lists>, name: string)` |
| M09.A10 | Delete smart list | destructive | `smart_lists.delete(smartListId*: id<smart_lists>)` |

## M10 Custom Fields (`custom_fields`)

Extend record schemas with typed business data.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M10.A01 | Create custom field | write | `custom_fields.create(module*: contacts\|leads\|companies\|opportunities\|tickets, label*: string, type*: text\|number\|date\|dropdown\|checkbox, options: string[], helpText: string)` |
| M10.A02 | Get field definition | read | `custom_fields.get(fieldId*: id<custom_fields>)` |
| M10.A03 | List fields for module | read | `custom_fields.list_for_module(query: string, ids: string[], module: contacts\|leads\|companies\|opportunities\|tickets, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M10.A04 | Rename field label | write | `custom_fields.rename_label(fieldId*: id<custom_fields>, label*: string)` |
| M10.A05 | Update field help text | write | `custom_fields.update_help_text(fieldId*: id<custom_fields>, helpText*: string)` |
| M10.A06 | Set field validation rules | write | `custom_fields.set_validation(fieldId*: id<custom_fields>, validation*: {required,min,max,maxLength,pattern})` |
| M10.A07 | Add dropdown option | write | `custom_fields.add_option(fieldId*: id<custom_fields>, value*: string)` |
| M10.A08 | Retire dropdown option | write | `custom_fields.retire_option(fieldId*: id<custom_fields>, value*: string)` |
| M10.A09 | Set record field value | write | `custom_fields.set_record_value(fieldId*: id<custom_fields>, recordId*: string, value*: string,number,boolean,null)` |
| M10.A10 | Archive custom field | destructive | `custom_fields.archive(fieldId*: id<custom_fields>)` |

## M11 Conversations (`conversations`)

Manage conversation threads across channels.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M11.A01 | Get conversation | read | `conversations.get(conversationId*: id<conversations>)` |
| M11.A02 | Search conversations | read | `conversations.search(query: string, ids: string[], contactId: id<contacts>, channel: email\|sms\|chat, status: open\|closed, ownerId: id<users>, unread: boolean, hasInbound: boolean, awaitingReply: boolean, ownerIds: string[], lastMessageFrom: date-time, lastMessageTo: date-time, lastInboundFrom: date-time, lastInboundTo: date-time, contactIds: string[], limit: integer)` |
| M11.A03 | Assign conversation owner | write | `conversations.assign_owner(conversationId*: id<conversations>, ownerId*: id<users>)` |
| M11.A04 | Mark conversation read | write | `conversations.mark_read(conversationId*: id<conversations>)` |
| M11.A05 | Mark conversation unread | write | `conversations.mark_unread(conversationId*: id<conversations>)` |
| M11.A06 | Close conversation | write | `conversations.close(conversationId*: id<conversations>)` |
| M11.A07 | Reopen conversation | write | `conversations.reopen(conversationId*: id<conversations>)` |
| M11.A08 | Add internal comment | write | `conversations.add_comment(conversationId*: id<conversations>, body*: string)` |
| M11.A09 | Summarize conversation history | read | `conversations.summarize(conversationId*: id<conversations>)` |
| M11.A10 | List unanswered conversations | read | `conversations.list_unanswered(ownerId: id<users>, olderThanHours: number, channel: email\|sms\|chat)` |

## M12 SMS (`sms`)

Prepare, send, and track text messages.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M12.A01 | Draft SMS | write | `sms.draft(contactId*: id<contacts>, body: string, templateId: id<templates>)` |
| M12.A02 | Preview SMS segmentation | read | `sms.preview_segmentation(body*: string)` |
| M12.A03 | Send SMS | external | `sms.send(smsId: id<sms>, contactId: id<contacts>, body: string, templateId: id<templates>)` |
| M12.A04 | Schedule SMS | external | `sms.schedule(smsId: id<sms>, contactId: id<contacts>, body: string, sendAt*: date-time)` |
| M12.A05 | Cancel scheduled SMS | destructive | `sms.cancel_scheduled(smsId*: id<sms>)` |
| M12.A06 | Get SMS details | read | `sms.get(smsId*: id<sms>)` |
| M12.A07 | Search SMS messages | read | `sms.search(query: string, ids: string[], contactId: id<contacts>, status: draft\|scheduled\|sent\|cancelled\|received, direction: inbound\|outbound, contactIds: string[], sentFrom: date-time, sentTo: date-time, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M12.A08 | Get SMS delivery status | read | `sms.delivery_status(smsId*: id<sms>)` |
| M12.A09 | Receive simulated inbound SMS | write | `sms.receive_inbound(contactId*: id<contacts>, body*: string)` |
| M12.A10 | Record SMS opt-out | write | `sms.record_opt_out(contactId*: id<contacts>)` |

## M13 Email (`email`)

Prepare, send, and track email messages.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M13.A01 | Draft email | write | `email.draft(contactId*: id<contacts>, subject: string, body: string, templateId: id<templates>, invoiceId: id<invoices>, category: general\|follow_up\|invoice_reminder\|marketing\|transactional\|review_request, variables: object)` |
| M13.A02 | Preview email | read | `email.preview(emailId: id<emails>, contactId: id<contacts>, subject: string, body: string, templateId: id<templates>, invoiceId: id<invoices>, category: general\|follow_up\|invoice_reminder\|marketing\|transactional\|review_request, variables: object)` |
| M13.A03 | Send email | external | `email.send(emailId: id<emails>, contactId: id<contacts>, subject: string, body: string, templateId: id<templates>, invoiceId: id<invoices>, category: general\|follow_up\|invoice_reminder\|marketing\|transactional\|review_request, variables: object)` |
| M13.A04 | Schedule email | external | `email.schedule(emailId*: id<emails>, sendAt*: date-time)` |
| M13.A05 | Cancel scheduled email | destructive | `email.cancel_scheduled(emailId*: id<emails>)` |
| M13.A06 | Get email details | read | `email.get(emailId*: id<emails>)` |
| M13.A07 | Search email messages | read | `email.search(query: string, ids: string[], contactId: id<contacts>, status: draft\|scheduled\|sent\|cancelled\|received\|draft\|scheduled\|sent\|cancelled\|received[], category: general\|follow_up\|invoice_reminder\|marketing\|transactional\|review_request, invoiceId: id<invoices>, direction: inbound\|outbound, invoiceIds: string[], sentFrom: date-time, sentTo: date-time, createdFrom: date-time, createdTo: date-time, contactIds: string[], limit: integer)` |
| M13.A08 | Get email delivery status | read | `email.delivery_status(emailId*: id<emails>)` |
| M13.A09 | Receive simulated inbound email | write | `email.receive_inbound(contactId*: id<contacts>, subject: string, body*: string)` |
| M13.A10 | Record email unsubscribe | write | `email.record_unsubscribe(contactId*: id<contacts>)` |

## M14 Message Templates (`templates`)

Manage reusable email and SMS content.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M14.A01 | Create message template | write | `templates.create(name*: string, channel*: email\|sms, subject: string, body*: string)` |
| M14.A02 | Get template | read | `templates.get(templateId*: id<templates>)` |
| M14.A03 | Search templates | read | `templates.search(query: string, ids: string[], channel: email\|sms, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M14.A04 | Update template content | write | `templates.update_content(templateId*: id<templates>, subject: string, body: string)` |
| M14.A05 | Archive template | destructive | `templates.archive(templateId*: id<templates>)` |
| M14.A06 | Duplicate template | write | `templates.duplicate(templateId*: id<templates>, name: string)` |
| M14.A07 | Define template variables | write | `templates.define_variables(templateId*: id<templates>, variables*: string[], defaults: object)` |
| M14.A08 | Validate template variables | read | `templates.validate_variables(templateId*: id<templates>)` |
| M14.A09 | Render template with sample data | read | `templates.render_sample(templateId*: id<templates>, variables: object)` |
| M14.A10 | Restore template version | write | `templates.restore_version(templateId*: id<templates>, version*: integer)` |

## M15 Campaigns (`campaigns`)

Coordinate audience-based outreach campaigns.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M15.A01 | Create campaign | write | `campaigns.create(name*: string, channel*: email\|sms, sourceChannel: string)` |
| M15.A02 | Get campaign details | read | `campaigns.get(campaignId*: id<campaigns>)` |
| M15.A03 | List campaigns | read | `campaigns.list(query: string, ids: string[], status: draft\|scheduled\|active\|paused\|completed, channel: email\|sms, sourceChannel: string, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M15.A04 | Set campaign audience | write | `campaigns.set_audience(campaignId*: id<campaigns>, type*: tag\|smart_list\|contacts, value*: string\|string[])` |
| M15.A05 | Add campaign message step | write | `campaigns.add_step(campaignId*: id<campaigns>, templateId: id<templates>, subject: string, delayDays: integer)` |
| M15.A06 | Set campaign schedule | write | `campaigns.set_schedule(campaignId*: id<campaigns>, startAt*: date-time, timezone: string)` |
| M15.A07 | Launch campaign | external | `campaigns.launch(campaignId*: id<campaigns>)` |
| M15.A08 | Pause campaign | write | `campaigns.pause(campaignId*: id<campaigns>)` |
| M15.A09 | Resume campaign | external | `campaigns.resume(campaignId*: id<campaigns>)` |
| M15.A10 | Get campaign performance | read | `campaigns.performance(campaignId*: id<campaigns>)` |

## M16 Workflows (`workflows`)

Build and operate multi-step automations.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M16.A01 | Create workflow | write | `workflows.create(name*: string, description: string, steps: {type,config}[])` |
| M16.A02 | Get workflow definition | read | `workflows.get(workflowId*: id<workflows>)` |
| M16.A03 | List workflows | read | `workflows.list(query: string, ids: string[], status: draft\|published\|paused, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M16.A04 | Add workflow step | write | `workflows.add_step(workflowId*: id<workflows>, type*: send_email\|send_sms\|create_task\|wait\|add_tag\|assign_owner\|notify_user\|branch, config: object, position: integer)` |
| M16.A05 | Update workflow step | write | `workflows.update_step(workflowId*: id<workflows>, stepId*: string, type: send_email\|send_sms\|create_task\|wait\|add_tag\|assign_owner\|notify_user\|branch, config: object)` |
| M16.A06 | Remove workflow step | destructive | `workflows.remove_step(workflowId*: id<workflows>, stepId*: string)` |
| M16.A07 | Validate workflow | read | `workflows.validate(workflowId*: id<workflows>)` |
| M16.A08 | Publish workflow | external | `workflows.publish(workflowId*: id<workflows>)` |
| M16.A09 | Pause workflow | write | `workflows.pause(workflowId*: id<workflows>)` |
| M16.A10 | Get workflow execution history | read | `workflows.execution_history(workflowId*: id<workflows>, status: success\|failed)` |

## M17 Event Triggers (`triggers`)

Connect incoming events to workflow execution.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M17.A01 | Create event trigger | write | `triggers.create(name*: string, eventType*: lead.created\|contact.created\|form.submitted\|appointment.booked\|appointment.no_show\|invoice.overdue\|payment.failed\|tag.added\|opportunity.stage_changed\|ticket.created\|review.received, workflowId: id<workflows>, conditions: {field,op,value}[])` |
| M17.A02 | Get trigger configuration | read | `triggers.get(triggerId*: id<triggers>)` |
| M17.A03 | List event triggers | read | `triggers.list(query: string, ids: string[], eventType: lead.created\|contact.created\|form.submitted\|appointment.booked\|appointment.no_show\|invoice.overdue\|payment.failed\|tag.added\|opportunity.stage_changed\|ticket.created\|review.received, workflowId: id<workflows>, enabled: boolean, workflowIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M17.A04 | Set trigger event type | write | `triggers.set_event_type(triggerId*: id<triggers>, eventType*: lead.created\|contact.created\|form.submitted\|appointment.booked\|appointment.no_show\|invoice.overdue\|payment.failed\|tag.added\|opportunity.stage_changed\|ticket.created\|review.received)` |
| M17.A05 | Update trigger conditions | write | `triggers.update_conditions(triggerId*: id<triggers>, conditions*: {field,op,value}[])` |
| M17.A06 | Bind trigger to workflow | write | `triggers.bind_workflow(triggerId*: id<triggers>, workflowId*: id<workflows>)` |
| M17.A07 | Enable trigger | external | `triggers.enable(triggerId*: id<triggers>)` |
| M17.A08 | Disable trigger | write | `triggers.disable(triggerId*: id<triggers>)` |
| M17.A09 | Test trigger with sample event | read | `triggers.test(triggerId*: id<triggers>, payload: object)` |
| M17.A10 | Get trigger firing history | read | `triggers.firing_history(triggerId*: id<triggers>)` |

## M18 Forms (`forms`)

Capture structured input through reusable forms.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M18.A01 | Create form | write | `forms.create(name*: string, fields: {label,type,required}[])` |
| M18.A02 | Get form definition | read | `forms.get(formId*: id<forms>)` |
| M18.A03 | List forms | read | `forms.list(query: string, ids: string[], status: draft\|published, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M18.A04 | Add form field | write | `forms.add_field(formId*: id<forms>, label*: string, type*: text\|email\|phone\|textarea\|number\|dropdown\|checkbox\|date, required: boolean, options: string[])` |
| M18.A05 | Update form field | write | `forms.update_field(formId*: id<forms>, fieldId*: string, label: string, type: text\|email\|phone\|textarea\|number\|dropdown\|checkbox\|date, required: boolean)` |
| M18.A06 | Reorder form fields | write | `forms.reorder_fields(formId*: id<forms>, fieldIds*: string[])` |
| M18.A07 | Set form validation rules | write | `forms.set_validation(formId*: id<forms>, validation*: {spamProtection,requireConsent,allowedEmailDomains})` |
| M18.A08 | Publish form | external | `forms.publish(formId*: id<forms>)` |
| M18.A09 | Submit simulated form response | write | `forms.submit_response(formId*: id<forms>, answers*: object)` |
| M18.A10 | List form submissions | read | `forms.list_submissions(formId*: id<forms>, submittedFrom: string, submittedTo: string)` |

## M19 Surveys (`surveys`)

Collect feedback with branching questionnaires.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M19.A01 | Create survey | write | `surveys.create(name*: string)` |
| M19.A02 | Get survey definition | read | `surveys.get(surveyId*: id<surveys>)` |
| M19.A03 | List surveys | read | `surveys.list(query: string, ids: string[], status: draft\|open\|closed, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M19.A04 | Add survey question | write | `surveys.add_question(surveyId*: id<surveys>, text*: string, type*: text\|scale\|single_choice\|multiple_choice\|yes_no, options: string[])` |
| M19.A05 | Update survey question | write | `surveys.update_question(surveyId*: id<surveys>, questionId*: string, text: string, type: text\|scale\|single_choice\|multiple_choice\|yes_no, options: string[])` |
| M19.A06 | Set question branching rules | write | `surveys.set_branching(surveyId*: id<surveys>, questionId*: string, rules*: {ifAnswer,gotoQuestionId}[])` |
| M19.A07 | Publish survey | external | `surveys.publish(surveyId*: id<surveys>)` |
| M19.A08 | Close survey | write | `surveys.close(surveyId*: id<surveys>)` |
| M19.A09 | Submit simulated survey response | write | `surveys.submit_response(surveyId*: id<surveys>, contactId: id<contacts>, answers*: object)` |
| M19.A10 | Get survey response summary | read | `surveys.response_summary(surveyId*: id<surveys>)` |

## M20 Calendars (`calendars`)

Configure calendars used for appointment booking.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M20.A01 | Create calendar | write | `calendars.create(name*: string, description: string, durationMinutes: integer, hostIds: id<users>[], timezone: string)` |
| M20.A02 | Get calendar settings | read | `calendars.get(calendarId*: id<calendars>)` |
| M20.A03 | List calendars | read | `calendars.list(query: string, ids: string[], visibility: public\|internal\|hidden, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M20.A04 | Update calendar details | write | `calendars.update(calendarId*: id<calendars>, name: string, description: string)` |
| M20.A05 | Set calendar timezone | write | `calendars.set_timezone(calendarId*: id<calendars>, timezone*: string)` |
| M20.A06 | Assign calendar host | write | `calendars.assign_host(calendarId*: id<calendars>, hostId*: id<users>)` |
| M20.A07 | Set appointment duration | write | `calendars.set_duration(calendarId*: id<calendars>, durationMinutes*: integer)` |
| M20.A08 | Set booking buffer | write | `calendars.set_buffer(calendarId*: id<calendars>, bufferMinutes*: integer)` |
| M20.A09 | Set calendar visibility | write | `calendars.set_visibility(calendarId*: id<calendars>, visibility*: public\|internal\|hidden)` |
| M20.A10 | Archive calendar | destructive | `calendars.archive(calendarId*: id<calendars>)` |

## M21 Appointments (`appointments`)

Manage booked meetings and their outcomes.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M21.A01 | Create appointment | write | `appointments.create(calendarId*: id<calendars>, contactId*: id<contacts>, startAt*: date-time, hostId: id<users>, title: string)` |
| M21.A02 | Get appointment details | read | `appointments.get(appointmentId*: id<appointments>)` |
| M21.A03 | Search appointments | read | `appointments.search(query: string, ids: string[], contactId: id<contacts>, hostId: id<users>, calendarId: id<calendars>, status: booked\|cancelled\|completed\|no_show\|booked\|cancelled\|completed\|no_show[], hostIds: string[], calendarIds: string[], startFrom: date-time, startTo: date-time, createdFrom: date-time, createdTo: date-time, contactIds: string[], upcoming: boolean, limit: integer)` |
| M21.A04 | Reschedule appointment | external | `appointments.reschedule(appointmentId*: id<appointments>, startAt*: date-time)` |
| M21.A05 | Cancel appointment | external | `appointments.cancel(appointmentId*: id<appointments>, reason: string)` |
| M21.A06 | Assign appointment host | write | `appointments.assign_host(appointmentId*: id<appointments>, hostId*: id<users>)` |
| M21.A07 | Add appointment attendee | write | `appointments.add_attendee(appointmentId*: id<appointments>, contactId*: id<contacts>)` |
| M21.A08 | Remove appointment attendee | write | `appointments.remove_attendee(appointmentId*: id<appointments>, contactId*: id<contacts>)` |
| M21.A09 | Mark attendee no-show | write | `appointments.mark_no_show(appointmentId*: id<appointments>, contactId: id<contacts>)` |
| M21.A10 | Mark appointment completed | write | `appointments.mark_completed(appointmentId*: id<appointments>, notes: string)` |

## M22 Availability (`availability`)

Manage bookable time and scheduling constraints.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M22.A01 | Set weekly working hours | write | `availability.set_weekly_hours(userId*: id<users>, weeklyHours*: object)` |
| M22.A02 | Get weekly working hours | read | `availability.get_weekly_hours(userId*: id<users>)` |
| M22.A03 | Add date-specific availability | write | `availability.add_date_override(userId*: id<users>, date*: date, ranges*: {start,end}[])` |
| M22.A04 | Remove date-specific availability | write | `availability.remove_date_override(userId*: id<users>, date*: date)` |
| M22.A05 | Block time range | write | `availability.block_time(userId*: id<users>, start*: date-time, end*: date-time, reason: string)` |
| M22.A06 | Remove time block | write | `availability.remove_block(userId*: id<users>, blockId*: string)` |
| M22.A07 | Set minimum booking notice | write | `availability.set_min_notice(userId*: id<users>, hours*: number)` |
| M22.A08 | Set maximum booking horizon | write | `availability.set_max_horizon(userId*: id<users>, days*: integer)` |
| M22.A09 | Find available slots | read | `availability.find_slots(userId*: id<users>, from*: date-time, to*: date-time, durationMinutes: integer, limit: integer)` |
| M22.A10 | Check scheduling conflicts | read | `availability.check_conflicts(userId*: id<users>, start*: date-time, end*: date-time)` |

## M23 Booking Pages (`booking_pages`)

Configure the public booking experience.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M23.A01 | Create booking page | write | `booking_pages.create(title*: string, slug: string, calendarId: id<calendars>)` |
| M23.A02 | Get booking page | read | `booking_pages.get(bookingPageId*: id<booking_pages>)` |
| M23.A03 | List booking pages | read | `booking_pages.list(query: string, ids: string[], published: boolean, calendarId: id<calendars>, calendarIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M23.A04 | Update booking page content | write | `booking_pages.update_content(bookingPageId*: id<booking_pages>, content*: {headline,body})` |
| M23.A05 | Link calendar to booking page | write | `booking_pages.link_calendar(bookingPageId*: id<booking_pages>, calendarId*: id<calendars>)` |
| M23.A06 | Set booking intake fields | write | `booking_pages.set_intake_fields(bookingPageId*: id<booking_pages>, intakeFields*: {key,label,required}[])` |
| M23.A07 | Set booking confirmation message | write | `booking_pages.set_confirmation_message(bookingPageId*: id<booking_pages>, confirmationMessage*: string)` |
| M23.A08 | Set booking redirect URL | write | `booking_pages.set_redirect_url(bookingPageId*: id<booking_pages>, redirectUrl*: uri)` |
| M23.A09 | Publish booking page | external | `booking_pages.publish(bookingPageId*: id<booking_pages>)` |
| M23.A10 | Unpublish booking page | external | `booking_pages.unpublish(bookingPageId*: id<booking_pages>)` |

## M24 Events (`events`)

Manage group sessions and registrations.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M24.A01 | Create event | write | `events.create(name*: string, startAt*: date-time, endAt: date-time, location: string, capacity: integer, description: string)` |
| M24.A02 | Get event details | read | `events.get(eventId*: id<events>)` |
| M24.A03 | Search events | read | `events.search(query: string, ids: string[], status: scheduled\|live\|completed\|cancelled, startFrom: date-time, startTo: date-time, limit: integer)` |
| M24.A04 | Update event details | write | `events.update(eventId*: id<events>, name: string, description: string, location: string, startAt: date-time, endAt: date-time)` |
| M24.A05 | Set event capacity | write | `events.set_capacity(eventId*: id<events>, capacity*: integer)` |
| M24.A06 | Register attendee | write | `events.register(eventId*: id<events>, contactId*: id<contacts>)` |
| M24.A07 | Cancel attendee registration | write | `events.cancel_registration(eventId*: id<events>, contactId*: id<contacts>)` |
| M24.A08 | Add attendee to waitlist | write | `events.add_to_waitlist(eventId*: id<events>, contactId*: id<contacts>)` |
| M24.A09 | Promote waitlisted attendee | write | `events.promote_waitlisted(eventId*: id<events>, contactId: id<contacts>)` |
| M24.A10 | Check in attendee | write | `events.check_in(eventId*: id<events>, contactId*: id<contacts>)` |

## M25 Products (`products`)

Manage items offered for purchase.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M25.A01 | Create product | write | `products.create(name*: string, description: string, category*: software\|services\|physical, basePrice*: number, sku: string)` |
| M25.A02 | Get product details | read | `products.get(productId*: id<products>)` |
| M25.A03 | Search products | read | `products.search(query: string, ids: string[], category: software\|services\|physical, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M25.A04 | Update product details | write | `products.update(productId*: id<products>, name: string, description: string, basePrice: number)` |
| M25.A05 | Archive product | destructive | `products.archive(productId*: id<products>)` |
| M25.A06 | Add product variant | write | `products.add_variant(productId*: id<products>, name*: string, sku*: string, inventory: integer)` |
| M25.A07 | Update product variant | write | `products.update_variant(productId*: id<products>, variantId*: string, name: string, sku: string)` |
| M25.A08 | Set product SKU | write | `products.set_sku(productId*: id<products>, sku*: string)` |
| M25.A09 | Set inventory quantity | write | `products.set_inventory(productId*: id<products>, quantity*: integer, variantId: string)` |
| M25.A10 | Get inventory availability | read | `products.inventory_availability(productId*: id<products>)` |

## M26 Prices (`prices`)

Define product prices and billing intervals.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M26.A01 | Create product price | write | `prices.create(productId*: id<products>, label*: string, amount*: number, currency: USD\|EUR\|GBP\|INR\|CAD\|AUD, interval*: one_time\|month\|year, trialDays: integer)` |
| M26.A02 | Get price details | read | `prices.get(priceId*: id<prices>)` |
| M26.A03 | List product prices | read | `prices.list_for_product(query: string, ids: string[], productId: id<products>, interval: one_time\|month\|year, currency: USD\|EUR\|GBP\|INR\|CAD\|AUD, productIds: string[], createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M26.A04 | Update price label | write | `prices.update_label(priceId*: id<prices>, label*: string)` |
| M26.A05 | Set price amount | write | `prices.set_amount(priceId*: id<prices>, amount*: number)` |
| M26.A06 | Set price currency | write | `prices.set_currency(priceId*: id<prices>, currency*: USD\|EUR\|GBP\|INR\|CAD\|AUD)` |
| M26.A07 | Set billing interval | write | `prices.set_interval(priceId*: id<prices>, interval*: one_time\|month\|year)` |
| M26.A08 | Set trial period | write | `prices.set_trial(priceId*: id<prices>, trialDays*: integer)` |
| M26.A09 | Set default product price | write | `prices.set_default(priceId*: id<prices>)` |
| M26.A10 | Archive price | destructive | `prices.archive(priceId*: id<prices>)` |

## M27 Quotes (`quotes`)

Prepare proposed purchases for customer acceptance.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M27.A01 | Create quote | write | `quotes.create(contactId*: id<contacts>, lineItems: {productId,description,quantity,unitPrice}[], expiresAt: date)` |
| M27.A02 | Get quote details | read | `quotes.get(quoteId*: id<quotes>)` |
| M27.A03 | Search quotes | read | `quotes.search(query: string, ids: string[], contactId: id<contacts>, status: draft\|sent\|accepted\|converted\|expired, contactIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M27.A04 | Add quote line item | write | `quotes.add_line_item(quoteId*: id<quotes>, productId: id<products>, description: string, quantity: number, unitPrice: number)` |
| M27.A05 | Update quote line item | write | `quotes.update_line_item(quoteId*: id<quotes>, lineItemId*: string, quantity: number, unitPrice: number, description: string)` |
| M27.A06 | Set quote expiry | write | `quotes.set_expiry(quoteId*: id<quotes>, expiresAt*: date)` |
| M27.A07 | Apply quote discount | write | `quotes.apply_discount(quoteId*: id<quotes>, type*: percent\|fixed, value*: number)` |
| M27.A08 | Send quote for acceptance | external | `quotes.send(quoteId*: id<quotes>)` |
| M27.A09 | Record quote acceptance | write | `quotes.record_acceptance(quoteId*: id<quotes>)` |
| M27.A10 | Convert accepted quote to invoice | write | `quotes.convert_to_invoice(quoteId*: id<quotes>)` |

## M28 Invoices (`invoices`)

Issue invoices and track outstanding balances.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M28.A01 | Create invoice | write | `invoices.create(contactId*: id<contacts>, lineItems: {productId,description,quantity,unitPrice}[], dueDate: date)` |
| M28.A02 | Get invoice details | read | `invoices.get(invoiceId*: id<invoices>)` |
| M28.A03 | Search invoices | read | `invoices.search(query: string, contactId: id<contacts>, contactIds: string[], status: draft\|issued\|paid\|void\|draft\|issued\|paid\|void[], unpaid: boolean, minDaysOverdue: integer, dueFrom: date-time, dueTo: date-time, limit: integer)` |
| M28.A04 | Add invoice line item | write | `invoices.add_line_item(invoiceId*: id<invoices>, productId: id<products>, description: string, quantity: number, unitPrice: number)` |
| M28.A05 | Update draft invoice | write | `invoices.update_draft(invoiceId*: id<invoices>, lineItems: {productId,description,quantity,unitPrice}[], discount: {type,value}\|null, notes: string)` |
| M28.A06 | Set invoice due date | write | `invoices.set_due_date(invoiceId*: id<invoices>, dueDate*: date)` |
| M28.A07 | Issue invoice | external | `invoices.issue(invoiceId*: id<invoices>)` |
| M28.A08 | Send invoice reminder | external | `invoices.send_reminder(invoiceId*: id<invoices>, templateId: id<templates>)` |
| M28.A09 | Void unpaid invoice | destructive | `invoices.void(invoiceId*: id<invoices>, reason: string)` |
| M28.A10 | List overdue invoices | read | `invoices.list_overdue(minDaysOverdue: integer, maxDaysOverdue: integer, contactId: id<contacts>, contactIds: string[])` |

## M29 Payments (`payments`)

Track payment attempts and invoice settlement.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M29.A01 | Create payment request | write | `payments.create_request(contactId*: id<contacts>, invoiceId: id<invoices>, amount: number)` |
| M29.A02 | Get payment request | read | `payments.get_request(paymentRequestId*: id<payment_requests>)` |
| M29.A03 | Cancel unpaid payment request | destructive | `payments.cancel_request(paymentRequestId*: id<payment_requests>)` |
| M29.A04 | Record simulated payment | write | `payments.record(contactId*: id<contacts>, amount*: number, method: card\|bank_transfer\|cash\|check, invoiceId: id<invoices>, paymentRequestId: id<payment_requests>, outcome: succeeded\|failed)` |
| M29.A05 | Get payment details | read | `payments.get(paymentId*: id<payments>)` |
| M29.A06 | Search payments | read | `payments.search(query: string, ids: string[], contactId: id<contacts>, status: succeeded\|failed, method: card\|bank_transfer\|cash\|check, contactIds: string[], processedFrom: date-time, processedTo: date-time, limit: integer)` |
| M29.A07 | Allocate payment to invoice | write | `payments.allocate(paymentId*: id<payments>, invoiceId*: id<invoices>, amount: number)` |
| M29.A08 | Remove payment allocation | write | `payments.remove_allocation(paymentId*: id<payments>, invoiceId*: id<invoices>)` |
| M29.A09 | Generate payment receipt | write | `payments.generate_receipt(paymentId*: id<payments>)` |
| M29.A10 | Get payment failure details | read | `payments.failure_details(paymentId*: id<payments>)` |

## M30 Subscriptions (`subscriptions`)

Manage recurring customer billing agreements.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M30.A01 | Create subscription | write | `subscriptions.create(contactId*: id<contacts>, priceId*: id<prices>, quantity: integer)` |
| M30.A02 | Get subscription details | read | `subscriptions.get(subscriptionId*: id<subscriptions>)` |
| M30.A03 | Search subscriptions | read | `subscriptions.search(query: string, ids: string[], contactId: id<contacts>, productId: id<products>, priceId: id<prices>, status: active\|trialing\|paused\|cancelled, contactIds: string[], productIds: string[], priceIds: string[], renewsFrom: date-time, renewsTo: date-time, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M30.A04 | Change subscription plan | write | `subscriptions.change_plan(subscriptionId*: id<subscriptions>, priceId*: id<prices>)` |
| M30.A05 | Update subscription quantity | write | `subscriptions.update_quantity(subscriptionId*: id<subscriptions>, quantity*: integer)` |
| M30.A06 | Set subscription trial end | write | `subscriptions.set_trial_end(subscriptionId*: id<subscriptions>, trialEndsAt*: date-time)` |
| M30.A07 | Pause subscription | write | `subscriptions.pause(subscriptionId*: id<subscriptions>)` |
| M30.A08 | Resume subscription | write | `subscriptions.resume(subscriptionId*: id<subscriptions>)` |
| M30.A09 | Cancel subscription | destructive | `subscriptions.cancel(subscriptionId*: id<subscriptions>, reason: string)` |
| M30.A10 | Preview next subscription invoice | read | `subscriptions.preview_next_invoice(subscriptionId*: id<subscriptions>)` |

## M31 Coupons (`coupons`)

Configure and validate promotional discounts.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M31.A01 | Create coupon | write | `coupons.create(code*: string, type*: percent\|fixed, value*: number, description: string, validTo: date-time, redemptionLimit: integer)` |
| M31.A02 | Get coupon details | read | `coupons.get(couponId*: id<coupons>)` |
| M31.A03 | Search coupons | read | `coupons.search(query: string, ids: string[], status: active\|inactive, type: percent\|fixed, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M31.A04 | Update coupon description | write | `coupons.update_description(couponId*: id<coupons>, description*: string)` |
| M31.A05 | Set discount value | write | `coupons.set_discount_value(couponId*: id<coupons>, type: percent\|fixed, value*: number)` |
| M31.A06 | Set coupon validity window | write | `coupons.set_validity_window(couponId*: id<coupons>, validFrom: date-time, validTo: date-time)` |
| M31.A07 | Set redemption limit | write | `coupons.set_redemption_limit(couponId*: id<coupons>, redemptionLimit*: integer\|null)` |
| M31.A08 | Restrict coupon to products | write | `coupons.restrict_to_products(couponId*: id<coupons>, productIds*: id<products>[])` |
| M31.A09 | Validate coupon for order | read | `coupons.validate_for_order(code*: string, orderId*: id<orders>)` |
| M31.A10 | Deactivate coupon | destructive | `coupons.deactivate(couponId*: id<coupons>)` |

## M32 Orders (`orders`)

Track purchases and fulfillment status.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M32.A01 | Create draft order | write | `orders.create_draft(contactId*: id<contacts>)` |
| M32.A02 | Get order details | read | `orders.get(orderId*: id<orders>)` |
| M32.A03 | Search orders | read | `orders.search(query: string, ids: string[], contactId: id<contacts>, status: draft\|submitted\|fulfilled\|cancelled, contactIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M32.A04 | Add order line item | write | `orders.add_line_item(orderId*: id<orders>, productId*: id<products>, variantId: string, quantity: integer)` |
| M32.A05 | Update order quantity | write | `orders.update_quantity(orderId*: id<orders>, lineItemId*: string, quantity*: integer)` |
| M32.A06 | Set order shipping address | write | `orders.set_shipping_address(orderId*: id<orders>, shippingAddress*: {line1,city,region,postalCode,country})` |
| M32.A07 | Apply coupon to order | write | `orders.apply_coupon(orderId*: id<orders>, code*: string)` |
| M32.A08 | Submit order | external | `orders.submit(orderId*: id<orders>)` |
| M32.A09 | Cancel order | destructive | `orders.cancel(orderId*: id<orders>, reason: string)` |
| M32.A10 | Mark order fulfilled | write | `orders.mark_fulfilled(orderId*: id<orders>, trackingNumber: string)` |

## M33 Refunds (`refunds`)

Manage refund requests against recorded payments.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M33.A01 | Create refund request | write | `refunds.create(paymentId*: id<payments>, amount: number, reason*: string)` |
| M33.A02 | Get refund request | read | `refunds.get(refundId*: id<refunds>)` |
| M33.A03 | Search refund requests | read | `refunds.search(query: string, ids: string[], contactId: id<contacts>, paymentId: id<payments>, status: requested\|approved\|rejected\|executed, contactIds: string[], paymentIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M33.A04 | Set refund reason | write | `refunds.set_reason(refundId*: id<refunds>, reason*: string)` |
| M33.A05 | Set partial refund amount | write | `refunds.set_partial_amount(refundId*: id<refunds>, amount*: number)` |
| M33.A06 | Check refundable balance | read | `refunds.refundable_balance(paymentId*: id<payments>)` |
| M33.A07 | Approve refund request | write | `refunds.approve(refundId*: id<refunds>)` |
| M33.A08 | Reject refund request | write | `refunds.reject(refundId*: id<refunds>, reason: string)` |
| M33.A09 | Execute simulated refund | external | `refunds.execute(refundId*: id<refunds>)` |
| M33.A10 | Get refund execution status | read | `refunds.execution_status(refundId*: id<refunds>)` |

## M34 Tax Rules (`tax_rules`)

Configure tax calculations for simulated sales.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M34.A01 | Create tax rule | write | `tax_rules.create(name*: string, rate*: number, region*: string, productCategories: software\|services\|physical[], inclusive: boolean)` |
| M34.A02 | Get tax rule | read | `tax_rules.get(taxRuleId*: id<tax_rules>)` |
| M34.A03 | List tax rules | read | `tax_rules.list(query: string, ids: string[], region: string, status: active\|inactive, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M34.A04 | Set tax rate | write | `tax_rules.set_rate(taxRuleId*: id<tax_rules>, rate*: number)` |
| M34.A05 | Set applicable region | write | `tax_rules.set_region(taxRuleId*: id<tax_rules>, region*: string)` |
| M34.A06 | Set product tax category | write | `tax_rules.set_product_categories(taxRuleId*: id<tax_rules>, productCategories*: software\|services\|physical[])` |
| M34.A07 | Set tax-inclusive pricing | write | `tax_rules.set_inclusive(taxRuleId*: id<tax_rules>, inclusive*: boolean)` |
| M34.A08 | Record customer tax exemption | write | `tax_rules.record_exemption(contactId*: id<contacts>, certificateNumber*: string, regions: string[])` |
| M34.A09 | Calculate tax for order | read | `tax_rules.calculate_for_order(orderId*: id<orders>, region: string)` |
| M34.A10 | Deactivate tax rule | destructive | `tax_rules.deactivate(taxRuleId*: id<tax_rules>)` |

## M35 Websites (`websites`)

Manage sites and their page collections.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M35.A01 | Create website | write | `websites.create(name*: string, domain: string)` |
| M35.A02 | Get website settings | read | `websites.get(websiteId*: id<websites>)` |
| M35.A03 | List websites | read | `websites.list(query: string, ids: string[], published: boolean, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M35.A04 | Rename website | write | `websites.rename(websiteId*: id<websites>, name*: string)` |
| M35.A05 | Add website page | write | `websites.add_page(websiteId*: id<websites>, title*: string, path: string)` |
| M35.A06 | Set website home page | write | `websites.set_home_page(websiteId*: id<websites>, pageId*: string)` |
| M35.A07 | Update site navigation | write | `websites.update_navigation(websiteId*: id<websites>, items*: {label,pageId}[])` |
| M35.A08 | Set site SEO defaults | write | `websites.set_seo_defaults(websiteId*: id<websites>, seo*: {titleTemplate,description,ogImageUrl})` |
| M35.A09 | Publish website | external | `websites.publish(websiteId*: id<websites>)` |
| M35.A10 | Unpublish website | external | `websites.unpublish(websiteId*: id<websites>)` |

## M36 Funnels (`funnels`)

Configure ordered journeys toward conversion.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M36.A01 | Create funnel | write | `funnels.create(name*: string)` |
| M36.A02 | Get funnel definition | read | `funnels.get(funnelId*: id<funnels>)` |
| M36.A03 | List funnels | read | `funnels.list(query: string, ids: string[], published: boolean, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M36.A04 | Add funnel step | write | `funnels.add_step(funnelId*: id<funnels>, name*: string, landingPageId: id<landing_pages>)` |
| M36.A05 | Reorder funnel steps | write | `funnels.reorder_steps(funnelId*: id<funnels>, stepIds*: string[])` |
| M36.A06 | Remove funnel step | destructive | `funnels.remove_step(funnelId*: id<funnels>, stepId*: string)` |
| M36.A07 | Link landing page to step | write | `funnels.link_landing_page(funnelId*: id<funnels>, stepId*: string, landingPageId*: id<landing_pages>)` |
| M36.A08 | Set funnel conversion goal | write | `funnels.set_goal(funnelId*: id<funnels>, goal*: {type,target})` |
| M36.A09 | Publish funnel | external | `funnels.publish(funnelId*: id<funnels>)` |
| M36.A10 | Get funnel conversion metrics | read | `funnels.conversion_metrics(funnelId*: id<funnels>)` |

## M37 Landing Pages (`landing_pages`)

Build and publish individual conversion pages.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M37.A01 | Create landing page | write | `landing_pages.create(title*: string, headline: string, slug: string)` |
| M37.A02 | Get landing page | read | `landing_pages.get(landingPageId*: id<landing_pages>)` |
| M37.A03 | Search landing pages | read | `landing_pages.search(query: string, ids: string[], published: boolean, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M37.A04 | Update page content | write | `landing_pages.update_content(landingPageId*: id<landing_pages>, content*: {headline,body})` |
| M37.A05 | Add page section | write | `landing_pages.add_section(landingPageId*: id<landing_pages>, type*: hero\|features\|testimonials\|pricing\|faq\|cta\|form, title: string)` |
| M37.A06 | Reorder page sections | write | `landing_pages.reorder_sections(landingPageId*: id<landing_pages>, sectionIds*: string[])` |
| M37.A07 | Attach form to page | write | `landing_pages.attach_form(landingPageId*: id<landing_pages>, formId*: id<forms>)` |
| M37.A08 | Set page SEO metadata | write | `landing_pages.set_seo(landingPageId*: id<landing_pages>, seo*: {title,description})` |
| M37.A09 | Publish landing page | external | `landing_pages.publish(landingPageId*: id<landing_pages>)` |
| M37.A10 | Unpublish landing page | external | `landing_pages.unpublish(landingPageId*: id<landing_pages>)` |

## M38 Blogs (`blogs`)

Manage articles and editorial publishing.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M38.A01 | Create blog post | write | `blogs.create_post(title*: string, body: string, authorId: id<users>, categories: string[])` |
| M38.A02 | Get blog post | read | `blogs.get_post(postId*: id<blog_posts>)` |
| M38.A03 | Search blog posts | read | `blogs.search_posts(query: string, ids: string[], status: draft\|scheduled\|published, authorId: id<users>, categories: string, authorIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M38.A04 | Update blog post | write | `blogs.update_post(postId*: id<blog_posts>, title: string, body: string)` |
| M38.A05 | Assign post author | write | `blogs.assign_author(postId*: id<blog_posts>, authorId*: id<users>)` |
| M38.A06 | Set post categories | write | `blogs.set_categories(postId*: id<blog_posts>, categories*: string[])` |
| M38.A07 | Set post SEO metadata | write | `blogs.set_seo(postId*: id<blog_posts>, seo*: {title,description})` |
| M38.A08 | Schedule post publication | external | `blogs.schedule(postId*: id<blog_posts>, publishAt*: date-time)` |
| M38.A09 | Publish post | external | `blogs.publish(postId*: id<blog_posts>)` |
| M38.A10 | Unpublish post | external | `blogs.unpublish(postId*: id<blog_posts>)` |

## M39 Media Assets (`media`)

Store and organize images and downloadable files.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M39.A01 | Upload media asset | write | `media.upload(name*: string, mime: string, sizeKb: integer, folder: string)` |
| M39.A02 | Get asset metadata | read | `media.get(assetId*: id<media_assets>)` |
| M39.A03 | Search media assets | read | `media.search(query: string, ids: string[], folder: string, mime: string, createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M39.A04 | Rename media asset | write | `media.rename(assetId*: id<media_assets>, name*: string)` |
| M39.A05 | Set asset alt text | write | `media.set_alt_text(assetId*: id<media_assets>, altText*: string)` |
| M39.A06 | Move asset to folder | write | `media.move_to_folder(assetId*: id<media_assets>, folder*: string)` |
| M39.A07 | Replace asset file | write | `media.replace_file(assetId*: id<media_assets>, sizeKb: integer, mime: string)` |
| M39.A08 | List asset references | read | `media.list_references(assetId*: id<media_assets>)` |
| M39.A09 | Generate asset access link | write | `media.generate_access_link(assetId*: id<media_assets>, expiresInHours: integer)` |
| M39.A10 | Delete unreferenced asset | destructive | `media.delete_unreferenced(assetId*: id<media_assets>)` |

## M40 Courses (`courses`)

Configure learning programs and their structure.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M40.A01 | Create course | write | `courses.create(title*: string, description: string, instructorId: id<users>)` |
| M40.A02 | Get course details | read | `courses.get(courseId*: id<courses>)` |
| M40.A03 | Search courses | read | `courses.search(query: string, ids: string[], status: draft\|published\|archived, instructorId: id<users>, instructorIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M40.A04 | Update course details | write | `courses.update(courseId*: id<courses>, title: string, description: string)` |
| M40.A05 | Add course section | write | `courses.add_section(courseId*: id<courses>, title*: string)` |
| M40.A06 | Reorder course sections | write | `courses.reorder_sections(courseId*: id<courses>, sectionIds*: string[])` |
| M40.A07 | Assign course instructor | write | `courses.assign_instructor(courseId*: id<courses>, instructorId*: id<users>)` |
| M40.A08 | Set course prerequisites | write | `courses.set_prerequisites(courseId*: id<courses>, prerequisiteIds*: id<courses>[])` |
| M40.A09 | Publish course | external | `courses.publish(courseId*: id<courses>)` |
| M40.A10 | Archive course | destructive | `courses.archive(courseId*: id<courses>)` |

## M41 Lessons (`lessons`)

Manage lesson content and completion conditions.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M41.A01 | Create lesson | write | `lessons.create(courseId*: id<courses>, sectionId: string, title*: string, content: string)` |
| M41.A02 | Get lesson details | read | `lessons.get(lessonId*: id<lessons>)` |
| M41.A03 | Search lessons | read | `lessons.search(query: string, ids: string[], courseId: id<courses>, sectionId: string, published: boolean, courseIds: string[], sectionIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M41.A04 | Update lesson content | write | `lessons.update_content(lessonId*: id<lessons>, content*: string)` |
| M41.A05 | Attach lesson media | write | `lessons.attach_media(lessonId*: id<lessons>, assetId*: id<media_assets>)` |
| M41.A06 | Move lesson to course section | write | `lessons.move_to_section(lessonId*: id<lessons>, sectionId*: string)` |
| M41.A07 | Set lesson release schedule | write | `lessons.set_release_schedule(lessonId*: id<lessons>, releaseAt*: date-time\|null)` |
| M41.A08 | Set lesson completion criteria | write | `lessons.set_completion_criteria(lessonId*: id<lessons>, completionCriteria*: {type,minPercent,passScore})` |
| M41.A09 | Publish lesson | external | `lessons.publish(lessonId*: id<lessons>)` |
| M41.A10 | Unpublish lesson | external | `lessons.unpublish(lessonId*: id<lessons>)` |

## M42 Enrollments (`enrollments`)

Manage learner access and learning progress.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M42.A01 | Enroll learner in course | write | `enrollments.enroll(contactId*: id<contacts>, courseId*: id<courses>, expiresAt: date-time)` |
| M42.A02 | Get enrollment details | read | `enrollments.get(enrollmentId*: id<enrollments>)` |
| M42.A03 | Search enrollments | read | `enrollments.search(query: string, ids: string[], contactId: id<contacts>, courseId: id<courses>, status: active\|suspended\|revoked\|completed, contactIds: string[], courseIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M42.A04 | Set enrollment expiry | write | `enrollments.set_expiry(enrollmentId*: id<enrollments>, expiresAt*: date-time\|null)` |
| M42.A05 | Suspend enrollment | write | `enrollments.suspend(enrollmentId*: id<enrollments>, reason: string)` |
| M42.A06 | Resume enrollment | write | `enrollments.resume(enrollmentId*: id<enrollments>)` |
| M42.A07 | Revoke enrollment | destructive | `enrollments.revoke(enrollmentId*: id<enrollments>)` |
| M42.A08 | Record lesson completion | write | `enrollments.record_lesson_completion(enrollmentId*: id<enrollments>, lessonId*: id<lessons>)` |
| M42.A09 | Get learner progress | read | `enrollments.progress(enrollmentId*: id<enrollments>)` |
| M42.A10 | Issue course completion certificate | external | `enrollments.issue_certificate(enrollmentId*: id<enrollments>)` |

## M43 Communities (`communities`)

Operate discussion spaces and moderate content.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M43.A01 | Create community | write | `communities.create(name*: string, description: string)` |
| M43.A02 | Get community details | read | `communities.get(communityId*: id<communities>)` |
| M43.A03 | Update community guidelines | write | `communities.update_guidelines(communityId*: id<communities>, guidelines*: string)` |
| M43.A04 | Create discussion channel | write | `communities.create_channel(communityId*: id<communities>, name*: string)` |
| M43.A05 | Join community | write | `communities.join(communityId*: id<communities>, contactId*: id<contacts>)` |
| M43.A06 | Leave community | write | `communities.leave(communityId*: id<communities>, contactId*: id<contacts>)` |
| M43.A07 | Create community post | external | `communities.create_post(communityId*: id<communities>, channelId*: string, authorContactId*: id<contacts>, body*: string)` |
| M43.A08 | Reply to community post | external | `communities.reply_to_post(postId*: id<community_posts>, authorContactId*: id<contacts>, body*: string)` |
| M43.A09 | Pin community post | write | `communities.pin_post(postId*: id<community_posts>, pinned: boolean)` |
| M43.A10 | Remove reported post | destructive | `communities.remove_reported_post(postId*: id<community_posts>, reason: string)` |

## M44 Memberships (`memberships`)

Manage access packages spanning courses and communities.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M44.A01 | Create membership plan | write | `memberships.create_plan(name*: string, description: string)` |
| M44.A02 | Get membership plan | read | `memberships.get_plan(planId*: id<membership_plans>)` |
| M44.A03 | List membership plans | read | `memberships.list_plans(query: string, ids: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M44.A04 | Update plan description | write | `memberships.update_plan_description(planId*: id<membership_plans>, description*: string)` |
| M44.A05 | Add plan entitlement | write | `memberships.add_entitlement(planId*: id<membership_plans>, type*: course\|community, resourceId*: string)` |
| M44.A06 | Remove plan entitlement | destructive | `memberships.remove_entitlement(planId*: id<membership_plans>, resourceId*: string)` |
| M44.A07 | Grant membership to contact | write | `memberships.grant(planId*: id<membership_plans>, contactId*: id<contacts>, expiresAt: date-time)` |
| M44.A08 | Set membership expiry | write | `memberships.set_expiry(membershipId*: id<memberships>, expiresAt*: date-time\|null)` |
| M44.A09 | Revoke membership | destructive | `memberships.revoke(membershipId*: id<memberships>)` |
| M44.A10 | Check member access | read | `memberships.check_access(contactId*: id<contacts>, resourceId*: string)` |

## M45 Reviews (`reviews`)

Collect and respond to customer reviews.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M45.A01 | Create review request | write | `reviews.create_request(contactId*: id<contacts>, channel*: email\|sms, message: string)` |
| M45.A02 | Send review request | external | `reviews.send_request(reviewRequestId*: id<review_requests>)` |
| M45.A03 | Cancel unsent review request | destructive | `reviews.cancel_request(reviewRequestId*: id<review_requests>)` |
| M45.A04 | List review requests | read | `reviews.list_requests(query: string, ids: string[], contactId: id<contacts>, channel: email\|sms, status: draft\|sent\|cancelled, contactIds: string[], createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M45.A05 | Record simulated customer review | write | `reviews.record_review(contactId*: id<contacts>, rating*: integer, text: string, platform: google\|facebook\|trustpilot\|yelp)` |
| M45.A06 | Search reviews | read | `reviews.search(query: string, ids: string[], platform: google\|facebook\|trustpilot\|yelp, contactId: id<contacts>, contactIds: string[], createdFrom: date-time, createdTo: date-time, minRating: integer, maxRating: integer, unanswered: boolean, limit: integer)` |
| M45.A07 | Get review details | read | `reviews.get(reviewId*: id<reviews>)` |
| M45.A08 | Draft review response | write | `reviews.draft_response(reviewId*: id<reviews>, body*: string)` |
| M45.A09 | Publish review response | external | `reviews.publish_response(reviewId*: id<reviews>)` |
| M45.A10 | Get review rating summary | read | `reviews.rating_summary(platform: google\|facebook\|trustpilot\|yelp)` |

## M46 Business Listings (`listings`)

Manage business profiles in simulated directories.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M46.A01 | Create business listing | write | `listings.create(directory*: Google Business Profile\|Yelp\|Bing Places\|Apple Maps\|Facebook, name*: string, address: string, phone: string)` |
| M46.A02 | Get listing details | read | `listings.get(listingId*: id<listings>)` |
| M46.A03 | Search business listings | read | `listings.search(query: string, ids: string[], directory: Google Business Profile\|Yelp\|Bing Places\|Apple Maps\|Facebook, syncStatus: synced\|pending_sync\|out_of_sync\|not_published, published: boolean, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M46.A04 | Update listing name | write | `listings.update_name(listingId*: id<listings>, name*: string)` |
| M46.A05 | Update listing address | write | `listings.update_address(listingId*: id<listings>, address*: string)` |
| M46.A06 | Update listing phone | write | `listings.update_phone(listingId*: id<listings>, phone*: string)` |
| M46.A07 | Set listing business hours | write | `listings.set_hours(listingId*: id<listings>, hours*: object)` |
| M46.A08 | Set listing categories | write | `listings.set_categories(listingId*: id<listings>, categories*: string[])` |
| M46.A09 | Publish listing to simulated directory | external | `listings.publish(listingId*: id<listings>)` |
| M46.A10 | Get listing sync status | read | `listings.sync_status(listingId*: id<listings>)` |

## M47 Support Tickets (`tickets`)

Track customer issues and resolution work.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M47.A01 | Create support ticket | write | `tickets.create(subject*: string, description: string, requesterContactId: id<contacts>, priority: low\|medium\|high\|urgent, ownerId: id<users>)` |
| M47.A02 | Get ticket details | read | `tickets.get(ticketId*: id<tickets>)` |
| M47.A03 | Search tickets | read | `tickets.search(query: string, ids: string[], status: open\|pending\|resolved\|closed\|open\|pending\|resolved\|closed[], priority: low\|medium\|high\|urgent, ownerId: id<users>, requesterContactId: id<contacts>, ownerIds: string[], requesterContactIds: string[], createdFrom: date-time, createdTo: date-time, unassigned: boolean, slaBreached: boolean, limit: integer)` |
| M47.A04 | Assign ticket owner | write | `tickets.assign_owner(ticketId*: id<tickets>, ownerId*: id<users>)` |
| M47.A05 | Set ticket priority | write | `tickets.set_priority(ticketId*: id<tickets>, priority*: low\|medium\|high\|urgent)` |
| M47.A06 | Update ticket status | write | `tickets.update_status(ticketId*: id<tickets>, status*: open\|pending\|resolved\|closed)` |
| M47.A07 | Add internal ticket note | write | `tickets.add_internal_note(ticketId*: id<tickets>, body*: string)` |
| M47.A08 | Reply to ticket requester | external | `tickets.reply_to_requester(ticketId*: id<tickets>, body*: string, setStatus: pending\|resolved)` |
| M47.A09 | Link ticket to contact | write | `tickets.link_contact(ticketId*: id<tickets>, requesterContactId*: id<contacts>)` |
| M47.A10 | Get ticket SLA status | read | `tickets.sla_status(ticketId*: id<tickets>)` |

## M48 Users (`users`)

Manage platform user accounts and access.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M48.A01 | Invite user | external | `users.invite(name*: string, email*: email, role*: admin\|sales_rep\|support\|marketing\|instructor\|viewer)` |
| M48.A02 | Get user profile | read | `users.get(userId*: id<users>)` |
| M48.A03 | List users | read | `users.list(query: string, role: admin\|sales_rep\|support\|marketing\|instructor\|viewer, status: active\|invited\|deactivated, teamId: id<teams>, availableNow: boolean)` |
| M48.A04 | Update user profile | write | `users.update_profile(userId*: id<users>, name: string, title: string, timezone: string)` |
| M48.A05 | Assign user role | write | `users.assign_role(userId*: id<users>, role*: admin\|sales_rep\|support\|marketing\|instructor\|viewer)` |
| M48.A06 | Revoke user role | destructive | `users.revoke_role(userId*: id<users>, role*: admin\|sales_rep\|support\|marketing\|instructor\|viewer)` |
| M48.A07 | Deactivate user | destructive | `users.deactivate(userId*: id<users>)` |
| M48.A08 | Reactivate user | write | `users.reactivate(userId*: id<users>)` |
| M48.A09 | List user permissions | read | `users.list_permissions(userId*: id<users>)` |
| M48.A10 | View user audit activity | read | `users.audit_activity(userId*: id<users>, limit: integer)` |

## M49 Teams (`teams`)

Organize users and shared work allocation.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M49.A01 | Create team | write | `teams.create(name*: string, memberIds: id<users>[])` |
| M49.A02 | Get team details | read | `teams.get(teamId*: id<teams>)` |
| M49.A03 | List teams | read | `teams.list(query: string, ids: string[], createdFrom: date-time, createdTo: date-time, includeArchived: boolean, limit: integer)` |
| M49.A04 | Rename team | write | `teams.rename(teamId*: id<teams>, name*: string)` |
| M49.A05 | Add team member | write | `teams.add_member(teamId*: id<teams>, userId*: id<users>)` |
| M49.A06 | Remove team member | write | `teams.remove_member(teamId*: id<teams>, userId*: id<users>)` |
| M49.A07 | Assign team manager | write | `teams.assign_manager(teamId*: id<teams>, managerId*: id<users>)` |
| M49.A08 | Set team assignment strategy | write | `teams.set_assignment_strategy(teamId*: id<teams>, assignmentStrategy*: round_robin\|least_busy\|manual)` |
| M49.A09 | Get team workload | read | `teams.workload(teamId: id<teams>)` |
| M49.A10 | Archive team | destructive | `teams.archive(teamId*: id<teams>)` |

## M50 Reports (`reports`)

Query business metrics and manage saved reports.

| Ref | Action | Effect | Signature |
|---|---|---|---|
| M50.A01 | Create saved report | write | `reports.create(name*: string, metric*: leads_created\|contacts_created\|deals_won\|revenue_won\|revenue\|tasks_completed\|appointments_booked\|tickets_opened\|invoices_overdue, groupBy: none\|source\|ownerId\|status\|day\|week\|priority\|platform, dateRange: {from,to,preset}, filters: {field,value}[])` |
| M50.A02 | Get report definition | read | `reports.get(reportId*: id<reports>)` |
| M50.A03 | List saved reports | read | `reports.list(query: string, ids: string[], metric: leads_created\|contacts_created\|deals_won\|revenue_won\|revenue\|tasks_completed\|appointments_booked\|tickets_opened\|invoices_overdue, createdFrom: date-time, createdTo: date-time, limit: integer)` |
| M50.A04 | Update report filters | write | `reports.update_filters(reportId*: id<reports>, filters*: {field,value}[])` |
| M50.A05 | Set report date range | write | `reports.set_date_range(reportId*: id<reports>, dateRange*: {from,to,preset})` |
| M50.A06 | Set report grouping | write | `reports.set_grouping(reportId*: id<reports>, groupBy*: none\|source\|ownerId\|status\|day\|week\|priority\|platform)` |
| M50.A07 | Run report | read | `reports.run(reportId: id<reports>, metric: leads_created\|contacts_created\|deals_won\|revenue_won\|revenue\|tasks_completed\|appointments_booked\|tickets_opened\|invoices_overdue, groupBy: none\|source\|ownerId\|status\|day\|week\|priority\|platform, dateRange: {from,to,preset}, filters: {field,value}[])` |
| M50.A08 | Compare report periods | read | `reports.compare_periods(reportId: id<reports>, metric: leads_created\|contacts_created\|deals_won\|revenue_won\|revenue\|tasks_completed\|appointments_booked\|tickets_opened\|invoices_overdue, days: integer, current: {from,to,preset}, previous: {from,to,preset})` |
| M50.A09 | Export report results | write | `reports.export(reportId*: id<reports>)` |
| M50.A10 | Schedule report delivery | external | `reports.schedule_delivery(reportId*: id<reports>, frequency*: daily\|weekly\|monthly, recipients*: email[])` |
