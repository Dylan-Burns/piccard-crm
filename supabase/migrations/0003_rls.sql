-- 0003_rls: row level security policies and column-level grants.
-- Source: docs/spec.md §3.3 and §2.10.

-- Enable RLS on every table.
alter table lead_sources enable row level security;
alter table customers enable row level security;
alter table properties enable row level security;
alter table opportunities enable row level security;
alter table opportunity_stage_history enable row level security;
alter table lead_submissions enable row level security;
alter table price_book_items enable row level security;
alter table estimates enable row level security;
alter table estimate_line_items enable row level security;
alter table jobs enable row level security;
alter table job_assignments enable row level security;
alter table appointments enable row level security;
alter table invoices enable row level security;
alter table invoice_line_items enable row level security;
alter table notes enable row level security;
alter table files enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table integration_connections enable row level security;   -- no policies: service role only
alter table sync_outbox enable row level security;               -- no policies: service role only
alter table email_log enable row level security;                 -- no policies: service role only

-- lead_sources
create policy lead_sources_select on lead_sources for select to authenticated using ((select private.is_staff()));
create policy lead_sources_write  on lead_sources for all    to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- customers
create policy customers_select on customers for select to authenticated
  using ((select private.is_staff()) or private.field_can_access_customer(id));
create policy customers_insert on customers for insert to authenticated with check ((select private.is_staff()));
create policy customers_update on customers for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy customers_delete on customers for delete to authenticated using ((select private.is_admin()));

-- properties
create policy properties_select on properties for select to authenticated
  using ((select private.is_staff()) or private.field_can_access_customer(customer_id));
create policy properties_insert on properties for insert to authenticated with check ((select private.is_staff()));
create policy properties_update on properties for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy properties_delete on properties for delete to authenticated using ((select private.is_admin()));

-- opportunities (field: nothing)
create policy opps_select on opportunities for select to authenticated using ((select private.is_staff()));
create policy opps_update on opportunities for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy opps_delete on opportunities for delete to authenticated using ((select private.is_admin()));

-- stage history and lead submissions: read-only to staff; written by triggers / service role.
create policy stage_history_select on opportunity_stage_history for select to authenticated using ((select private.is_staff()));
create policy lead_submissions_select on lead_submissions for select to authenticated using ((select private.is_staff()));

-- price book
create policy price_book_select on price_book_items for select to authenticated using ((select private.is_staff()));
create policy price_book_write  on price_book_items for all    to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- estimates + lines
create policy estimates_select on estimates for select to authenticated using ((select private.is_staff()));
create policy estimates_update on estimates for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
-- inserts: create_estimate / revise_estimate (security definer)
create policy estimates_delete on estimates for delete to authenticated using ((select private.is_admin()) and status = 'draft');
create policy estimate_lines_select on estimate_line_items for select to authenticated using ((select private.is_staff()));
-- writes: save_estimate_lines (security definer)

-- jobs
create policy jobs_select on jobs for select to authenticated
  using ((select private.is_staff()) or exists (select 1 from job_assignments ja where ja.job_id = jobs.id and ja.user_id = auth.uid()));
create policy jobs_update on jobs for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy jobs_delete on jobs for delete to authenticated using ((select private.is_admin()));
-- no insert policy: jobs are created only by mark_opportunity_won (security definer).

-- job_assignments
create policy job_assign_select on job_assignments for select to authenticated using ((select private.is_staff()) or user_id = auth.uid());
create policy job_assign_write  on job_assignments for all    to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));

-- appointments
create policy appts_select on appointments for select to authenticated using ((select private.is_staff()) or assigned_to = auth.uid());
create policy appts_update on appointments for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy appts_delete on appointments for delete to authenticated using ((select private.is_admin()));
-- inserts and time/assignee/status changes go through schedule_appointment, reschedule_appointment,
-- cancel_appointment, complete_appointment (security definer). Column grants allow only title/notes here.

-- invoices + lines
create policy invoices_select on invoices for select to authenticated using ((select private.is_staff()));
create policy invoices_update on invoices for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoice_lines_select on invoice_line_items for select to authenticated using ((select private.is_staff()));
-- all other invoice writes: invoice RPCs (§4.6), admin-guarded.

-- notes
create policy notes_select on notes for select to authenticated
  using ((select private.is_staff()) or (opportunity_id is not null and private.field_can_access_opportunity(opportunity_id)));
create policy notes_insert on notes for insert to authenticated
  with check (author_id = auth.uid() and
              ((select private.is_staff()) or (opportunity_id is not null and private.field_can_access_opportunity(opportunity_id))));
create policy notes_update on notes for update to authenticated
  using (author_id = auth.uid() or (select private.is_admin())) with check (author_id = auth.uid() or (select private.is_admin()));
create policy notes_delete on notes for delete to authenticated using (author_id = auth.uid() or (select private.is_admin()));

-- files (rows are inserted by register_files, security definer; staff may also insert directly)
create policy files_select on files for select to authenticated
  using ((select private.is_staff())
         or (opportunity_id is not null
             and category in ('photo','measurement_report','permit','other')
             and private.field_can_access_opportunity(opportunity_id)));
create policy files_update on files for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy files_delete on files for delete to authenticated using ((select private.is_admin()));

-- activities: append-only, written only by RPCs and triggers.
create policy activities_select on activities for select to authenticated using ((select private.is_staff()));

-- tasks
create policy tasks_select on tasks for select to authenticated using ((select private.is_staff()) or assigned_to = auth.uid());
create policy tasks_insert on tasks for insert to authenticated with check ((select private.is_staff()));
create policy tasks_update on tasks for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
-- field users complete their tasks only through set_task_status.
create policy tasks_delete on tasks for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants (§2.10). RLS decides rows; these decide columns. anon gets nothing.
-- Lifecycle, total, and sync columns are never granted: they change only through RPCs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 0001 tables (re-granted after the blanket revoke above)
grant select on public.profiles to authenticated;
grant update (full_name, phone, role, is_active) on public.profiles to authenticated;
grant select on public.company_settings to authenticated;
grant update (company_name, address_line1, city, state, postal_code, phone, email, license_number,
              logo_path, timezone, default_tax_rate, default_deposit_percent, estimate_valid_days,
              estimate_terms, default_warranty_years, default_lead_owner_id, send_inspection_confirmation)
  on public.company_settings to authenticated;

grant select on public.lead_sources, public.customers, public.properties, public.opportunities,
  public.opportunity_stage_history, public.lead_submissions, public.price_book_items, public.estimates,
  public.estimate_line_items, public.jobs, public.job_assignments, public.appointments, public.invoices,
  public.invoice_line_items, public.notes, public.files, public.activities, public.tasks
  to authenticated;
-- integration_connections, sync_outbox, email_log: service role only (no grants).

grant insert (name, sort_order), update (name, is_active, sort_order), delete on public.lead_sources to authenticated;

grant insert (first_name, last_name, company_name, email, phone, phone_e164, secondary_phone, preferred_contact,
              billing_address_line1, billing_city, billing_state, billing_postal_code),
      update (first_name, last_name, company_name, email, phone, phone_e164, secondary_phone, preferred_contact,
              billing_address_line1, billing_city, billing_state, billing_postal_code, archived_at),
      delete on public.customers to authenticated;

grant insert (customer_id, label, address_line1, address_line2, city, state, postal_code, roof_type, stories,
              access_notes, is_primary),
      update (label, address_line1, address_line2, city, state, postal_code, roof_type, stories,
              access_notes, is_primary),
      delete on public.properties to authenticated;

grant update (title, work_type, description, property_id, source_id, source_detail, estimated_value_cents,
              is_insurance_claim, insurance_carrier, claim_number, adjuster_name, adjuster_phone,
              deductible_cents, possible_duplicate_of),
      delete on public.opportunities to authenticated;

grant insert (name, description, unit, unit_price_cents, is_taxable),
      update (name, description, unit, unit_price_cents, is_taxable, is_active),
      delete on public.price_book_items to authenticated;

grant update (title, scope_notes, terms, discount_cents, tax_rate, deposit_percent, valid_until),
      delete on public.estimates to authenticated;

grant update (title, permit_status, permit_number, warranty_years, scope_summary),
      delete on public.jobs to authenticated;

grant insert (job_id, user_id), delete on public.job_assignments to authenticated;

grant update (title, notes), delete on public.appointments to authenticated;

grant update (due_on) on public.invoices to authenticated;

grant insert (body, customer_id, opportunity_id, job_id, is_pinned),
      update (body, is_pinned),
      delete on public.notes to authenticated;

grant update (category, caption), delete on public.files to authenticated;

grant insert (title, description, due_at, customer_id, opportunity_id, job_id, assigned_to),
      update (title, description, due_at, assigned_to),
      delete on public.tasks to authenticated;

-- Ownership defaults so users never supply these columns (and cannot spoof them).
alter table public.customers alter column created_by set default auth.uid();
alter table public.notes     alter column author_id  set default auth.uid();
alter table public.tasks     alter column created_by set default auth.uid();
