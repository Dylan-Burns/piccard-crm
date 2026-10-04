export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          actor_id: string | null
          created_at: string
          customer_id: string
          id: string
          job_id: string | null
          metadata: Json
          occurred_at: string
          opportunity_id: string | null
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          job_id?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          job_id?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          summary?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          all_day: boolean
          assigned_to: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          ends_at: string
          google_event_id: string | null
          google_sync_error: string | null
          google_sync_status: Database["public"]["Enums"]["sync_status"]
          google_synced_at: string | null
          id: string
          job_id: string | null
          notes: string | null
          opportunity_id: string
          outcome_notes: string | null
          property_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          title: string
          type: Database["public"]["Enums"]["appointment_type"]
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          assigned_to: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          ends_at: string
          google_event_id?: string | null
          google_sync_error?: string | null
          google_sync_status?: Database["public"]["Enums"]["sync_status"]
          google_synced_at?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          opportunity_id: string
          outcome_notes?: string | null
          property_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title: string
          type: Database["public"]["Enums"]["appointment_type"]
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          assigned_to?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          ends_at?: string
          google_event_id?: string | null
          google_sync_error?: string | null
          google_sync_status?: Database["public"]["Enums"]["sync_status"]
          google_synced_at?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          opportunity_id?: string
          outcome_notes?: string | null
          property_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string
          type?: Database["public"]["Enums"]["appointment_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          address_line1: string | null
          city: string | null
          company_name: string
          default_deposit_percent: number
          default_lead_owner_id: string | null
          default_tax_rate: number
          default_warranty_years: number
          email: string | null
          estimate_terms: string
          estimate_valid_days: number
          id: boolean
          license_number: string | null
          logo_path: string | null
          phone: string | null
          postal_code: string | null
          send_inspection_confirmation: boolean
          state: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          city?: string | null
          company_name?: string
          default_deposit_percent?: number
          default_lead_owner_id?: string | null
          default_tax_rate?: number
          default_warranty_years?: number
          email?: string | null
          estimate_terms?: string
          estimate_valid_days?: number
          id?: boolean
          license_number?: string | null
          logo_path?: string | null
          phone?: string | null
          postal_code?: string | null
          send_inspection_confirmation?: boolean
          state?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          city?: string | null
          company_name?: string
          default_deposit_percent?: number
          default_lead_owner_id?: string | null
          default_tax_rate?: number
          default_warranty_years?: number
          email?: string | null
          estimate_terms?: string
          estimate_valid_days?: number
          id?: boolean
          license_number?: string | null
          logo_path?: string | null
          phone?: string | null
          postal_code?: string | null
          send_inspection_confirmation?: boolean
          state?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_default_lead_owner_id_fkey"
            columns: ["default_lead_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          archived_at: string | null
          billing_address_line1: string | null
          billing_city: string | null
          billing_postal_code: string | null
          billing_state: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          phone_e164: string | null
          preferred_contact: string | null
          qbo_customer_id: string | null
          secondary_phone: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          billing_address_line1?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          billing_state?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string
          phone?: string | null
          phone_e164?: string | null
          preferred_contact?: string | null
          qbo_customer_id?: string | null
          secondary_phone?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          billing_address_line1?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          billing_state?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          phone_e164?: string | null
          preferred_contact?: string | null
          qbo_customer_id?: string | null
          secondary_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          last_attempt_at: string | null
          opportunity_id: string | null
          props: Json
          resend_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_status"]
          subject: string
          template: string
          to_email: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          opportunity_id?: string | null
          props?: Json
          resend_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject: string
          template: string
          to_email: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          opportunity_id?: string | null
          props?: Json
          resend_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject?: string
          template?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_line_items: {
        Row: {
          created_at: string
          description: string | null
          estimate_id: string
          id: string
          is_taxable: boolean
          name: string
          quantity: number
          sort_order: number
          total_cents: number | null
          unit: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimate_id: string
          id?: string
          is_taxable?: boolean
          name: string
          quantity?: number
          sort_order?: number
          total_cents?: number | null
          unit?: string
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          description?: string | null
          estimate_id?: string
          id?: string
          is_taxable?: boolean
          name?: string
          quantity?: number
          sort_order?: number
          total_cents?: number | null
          unit?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          accepted_at: string | null
          accepted_ip: unknown
          accepted_name: string | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          declined_at: string | null
          deposit_cents: number
          deposit_percent: number
          discount_cents: number
          estimate_number: number
          id: string
          opportunity_id: string
          pdf_path: string | null
          public_token: string
          scope_notes: string | null
          sent_at: string | null
          sent_to_email: string | null
          status: Database["public"]["Enums"]["estimate_status"]
          subtotal_cents: number
          tax_cents: number
          tax_rate: number
          terms: string
          title: string
          total_cents: number
          updated_at: string
          valid_until: string | null
          version: number
          viewed_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_ip?: unknown
          accepted_name?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          deposit_cents?: number
          deposit_percent?: number
          discount_cents?: number
          estimate_number?: number
          id?: string
          opportunity_id: string
          pdf_path?: string | null
          public_token?: string
          scope_notes?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          subtotal_cents?: number
          tax_cents?: number
          tax_rate?: number
          terms?: string
          title: string
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          viewed_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_ip?: unknown
          accepted_name?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          deposit_cents?: number
          deposit_percent?: number
          discount_cents?: number
          estimate_number?: number
          id?: string
          opportunity_id?: string
          pdf_path?: string | null
          public_token?: string
          scope_notes?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          subtotal_cents?: number
          tax_cents?: number
          tax_rate?: number
          terms?: string
          title?: string
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          appointment_id: string | null
          caption: string | null
          category: Database["public"]["Enums"]["file_category"]
          created_at: string
          customer_id: string
          file_name: string
          id: string
          job_id: string | null
          mime_type: string
          opportunity_id: string | null
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          appointment_id?: string | null
          caption?: string | null
          category?: Database["public"]["Enums"]["file_category"]
          created_at?: string
          customer_id: string
          file_name: string
          id?: string
          job_id?: string | null
          mime_type: string
          opportunity_id?: string | null
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          appointment_id?: string | null
          caption?: string | null
          category?: Database["public"]["Enums"]["file_category"]
          created_at?: string
          customer_id?: string
          file_name?: string
          id?: string
          job_id?: string | null
          mime_type?: string
          opportunity_id?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          access_token_enc: string | null
          config: Json
          connected_by: string | null
          created_at: string
          expires_at: string | null
          external_account_id: string | null
          last_error: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_enc: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_token_enc?: string | null
          config?: Json
          connected_by?: string | null
          created_at?: string
          expires_at?: string | null
          external_account_id?: string | null
          last_error?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_enc?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_token_enc?: string | null
          config?: Json
          connected_by?: string | null
          created_at?: string
          expires_at?: string | null
          external_account_id?: string | null
          last_error?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          refresh_token_enc?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          sort_order: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          sort_order?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid_cents: number
          created_at: string
          customer_id: string
          due_on: string | null
          estimate_id: string | null
          id: string
          invoice_number: number
          issued_on: string | null
          job_id: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          paid_at: string | null
          qbo_doc_number: string | null
          qbo_invoice_id: string | null
          qbo_sync_error: string | null
          qbo_sync_status: Database["public"]["Enums"]["sync_status"]
          qbo_synced_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          amount_paid_cents?: number
          created_at?: string
          customer_id: string
          due_on?: string | null
          estimate_id?: string | null
          id?: string
          invoice_number?: number
          issued_on?: string | null
          job_id: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          paid_at?: string | null
          qbo_doc_number?: string | null
          qbo_invoice_id?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: Database["public"]["Enums"]["sync_status"]
          qbo_synced_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          amount_paid_cents?: number
          created_at?: string
          customer_id?: string
          due_on?: string | null
          estimate_id?: string | null
          id?: string
          invoice_number?: number
          issued_on?: string | null
          job_id?: string
          kind?: Database["public"]["Enums"]["invoice_kind"]
          paid_at?: string | null
          qbo_doc_number?: string | null
          qbo_invoice_id?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: Database["public"]["Enums"]["sync_status"]
          qbo_synced_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          created_at: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          accepted_estimate_id: string | null
          completed_at: string | null
          created_at: string
          customer_id: string
          id: string
          job_number: number
          opportunity_id: string
          permit_number: string | null
          permit_status: Database["public"]["Enums"]["permit_status"]
          property_id: string
          scheduled_end: string | null
          scheduled_start: string | null
          scope_summary: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
          warranty_expires_on: string | null
          warranty_years: number | null
          work_type: Database["public"]["Enums"]["work_type"]
        }
        Insert: {
          accepted_estimate_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          job_number?: number
          opportunity_id: string
          permit_number?: string | null
          permit_status?: Database["public"]["Enums"]["permit_status"]
          property_id: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          scope_summary?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
          warranty_expires_on?: string | null
          warranty_years?: number | null
          work_type: Database["public"]["Enums"]["work_type"]
        }
        Update: {
          accepted_estimate_id?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          job_number?: number
          opportunity_id?: string
          permit_number?: string | null
          permit_status?: Database["public"]["Enums"]["permit_status"]
          property_id?: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          scope_summary?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
          warranty_expires_on?: string | null
          warranty_years?: number | null
          work_type?: Database["public"]["Enums"]["work_type"]
        }
        Relationships: [
          {
            foreignKeyName: "jobs_accepted_estimate_id_fkey"
            columns: ["accepted_estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_customer_id_fkey"
            columns: ["property_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id", "customer_id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      lead_submissions: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["lead_channel"]
          customer_id: string | null
          error: string | null
          external_id: string | null
          id: string
          opportunity_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          source_ip: unknown
          status: Database["public"]["Enums"]["lead_submission_status"]
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["lead_channel"]
          customer_id?: string | null
          error?: string | null
          external_id?: string | null
          id?: string
          opportunity_id?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          source_ip?: unknown
          status?: Database["public"]["Enums"]["lead_submission_status"]
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["lead_channel"]
          customer_id?: string | null
          error?: string | null
          external_id?: string | null
          id?: string
          opportunity_id?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          source_ip?: unknown
          status?: Database["public"]["Enums"]["lead_submission_status"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_submissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_submissions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          customer_id: string
          id: string
          is_pinned: boolean
          job_id: string | null
          opportunity_id: string | null
          shared_with_crew: boolean
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          customer_id: string
          id?: string
          is_pinned?: boolean
          job_id?: string | null
          opportunity_id?: string | null
          shared_with_crew?: boolean
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_pinned?: boolean
          job_id?: string | null
          opportunity_id?: string | null
          shared_with_crew?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          adjuster_name: string | null
          adjuster_phone: string | null
          amount_cents: number | null
          claim_number: string | null
          closed_by: string | null
          closed_owner_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deductible_cents: number | null
          description: string | null
          estimated_value_cents: number | null
          first_contact_attempted_at: string | null
          first_contact_attempted_by: string | null
          first_contacted_at: string | null
          gclid: string | null
          id: string
          insurance_carrier: string | null
          is_insurance_claim: boolean
          lost_at: string | null
          lost_competitor: string | null
          lost_notes: string | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          owner_id: string | null
          possible_duplicate_of: string | null
          property_id: string | null
          source_detail: string | null
          source_id: string | null
          stage: Database["public"]["Enums"]["opportunity_stage"]
          stage_entered_at: string
          title: string
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          won_at: string | null
          work_type: Database["public"]["Enums"]["work_type"] | null
        }
        Insert: {
          adjuster_name?: string | null
          adjuster_phone?: string | null
          amount_cents?: number | null
          claim_number?: string | null
          closed_by?: string | null
          closed_owner_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deductible_cents?: number | null
          description?: string | null
          estimated_value_cents?: number | null
          first_contact_attempted_at?: string | null
          first_contact_attempted_by?: string | null
          first_contacted_at?: string | null
          gclid?: string | null
          id?: string
          insurance_carrier?: string | null
          is_insurance_claim?: boolean
          lost_at?: string | null
          lost_competitor?: string | null
          lost_notes?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          owner_id?: string | null
          possible_duplicate_of?: string | null
          property_id?: string | null
          source_detail?: string | null
          source_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          stage_entered_at?: string
          title: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          won_at?: string | null
          work_type?: Database["public"]["Enums"]["work_type"] | null
        }
        Update: {
          adjuster_name?: string | null
          adjuster_phone?: string | null
          amount_cents?: number | null
          claim_number?: string | null
          closed_by?: string | null
          closed_owner_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deductible_cents?: number | null
          description?: string | null
          estimated_value_cents?: number | null
          first_contact_attempted_at?: string | null
          first_contact_attempted_by?: string | null
          first_contacted_at?: string | null
          gclid?: string | null
          id?: string
          insurance_carrier?: string | null
          is_insurance_claim?: boolean
          lost_at?: string | null
          lost_competitor?: string | null
          lost_notes?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          owner_id?: string | null
          possible_duplicate_of?: string | null
          property_id?: string | null
          source_detail?: string | null
          source_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          stage_entered_at?: string
          title?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          won_at?: string | null
          work_type?: Database["public"]["Enums"]["work_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_closed_owner_id_fkey"
            columns: ["closed_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_first_contact_attempted_by_fkey"
            columns: ["first_contact_attempted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_property_id_customer_id_fkey"
            columns: ["property_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id", "customer_id"]
          },
          {
            foreignKeyName: "opportunities_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage: Database["public"]["Enums"]["opportunity_stage"] | null
          id: string
          opportunity_id: string
          to_stage: Database["public"]["Enums"]["opportunity_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          opportunity_id: string
          to_stage: Database["public"]["Enums"]["opportunity_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          opportunity_id?: string
          to_stage?: Database["public"]["Enums"]["opportunity_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      price_book_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_taxable: boolean
          name: string
          unit: string
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          name: string
          unit?: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          name?: string
          unit?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          access_notes: string | null
          address_key: string | null
          address_line1: string
          address_line2: string | null
          city: string | null
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          label: string | null
          postal_code: string | null
          roof_type: string | null
          state: string | null
          stories: number | null
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          address_key?: string | null
          address_line1: string
          address_line2?: string | null
          city?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          label?: string | null
          postal_code?: string | null
          roof_type?: string | null
          state?: string | null
          stories?: number | null
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          address_key?: string | null
          address_line1?: string
          address_line2?: string | null
          city?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          postal_code?: string | null
          roof_type?: string | null
          state?: string | null
          stories?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_outbox: {
        Row: {
          attempts: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          processed_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["outbox_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          processed_at?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string
          auto_key: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          description: string | null
          due_at: string
          id: string
          job_id: string | null
          opportunity_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          auto_key?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at: string
          id?: string
          job_id?: string | null
          opportunity_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          auto_key?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_at?: string
          id?: string
          job_id?: string | null
          opportunity_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_owner: {
        Args: { p_opportunity_id: string; p_owner_id: string }
        Returns: Json
      }
      cancel_appointment: {
        Args: { p_appointment_id: string; p_reason?: string }
        Returns: Json
      }
      change_opportunity_stage: {
        Args: {
          p_fill?: Json
          p_opportunity_id: string
          p_to_stage: Database["public"]["Enums"]["opportunity_stage"]
        }
        Returns: Json
      }
      complete_appointment: {
        Args: {
          p_appointment_id: string
          p_outcome_notes?: string
          p_status: Database["public"]["Enums"]["appointment_status"]
        }
        Returns: Json
      }
      create_estimate: {
        Args: { p_opportunity_id: string; p_title?: string }
        Returns: Json
      }
      create_lead: { Args: { p: Json }; Returns: Json }
      log_contact: {
        Args: {
          p_opportunity_id: string
          p_outcome: string
          p_summary?: string
          p_type: string
        }
        Returns: Json
      }
      mark_files_verified: { Args: { p_paths: string[] }; Returns: number }
      mark_opportunity_lost: {
        Args: {
          p_competitor?: string
          p_notes?: string
          p_opportunity_id: string
          p_reason: Database["public"]["Enums"]["lost_reason"]
        }
        Returns: Json
      }
      mark_opportunity_won: {
        Args: {
          p_amount_cents?: number
          p_estimate_id?: string
          p_opportunity_id: string
        }
        Returns: Json
      }
      process_lead_submission: {
        Args: { p_lead: Json; p_submission_id: string }
        Returns: Json
      }
      register_files: { Args: { p: Json }; Returns: Json }
      reopen_opportunity: {
        Args: {
          p_opportunity_id: string
          p_to_stage: Database["public"]["Enums"]["opportunity_stage"]
        }
        Returns: Json
      }
      reschedule_appointment: {
        Args: {
          p_appointment_id: string
          p_assigned_to?: string
          p_ends_at: string
          p_starts_at: string
        }
        Returns: Json
      }
      save_estimate_lines: {
        Args: { p_estimate_id: string; p_lines: Json }
        Returns: Json
      }
      schedule_appointment: { Args: { p: Json }; Returns: Json }
      schedule_job: {
        Args: {
          p_assignees: string[]
          p_days: string[]
          p_end: string
          p_job_id: string
          p_start: string
        }
        Returns: Json
      }
      set_job_status: {
        Args: {
          p_job_id: string
          p_status: Database["public"]["Enums"]["job_status"]
        }
        Returns: Json
      }
      set_task_status: {
        Args: {
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: Json
      }
      void_estimate: { Args: { p_estimate_id: string }; Returns: Json }
    }
    Enums: {
      activity_type:
        | "lead_received"
        | "duplicate_inquiry"
        | "call"
        | "email"
        | "sms"
        | "note_added"
        | "stage_changed"
        | "owner_changed"
        | "deal_won"
        | "deal_lost"
        | "deal_reopened"
        | "appointment_scheduled"
        | "appointment_rescheduled"
        | "appointment_completed"
        | "appointment_cancelled"
        | "files_uploaded"
        | "estimate_created"
        | "estimate_sent"
        | "estimate_viewed"
        | "estimate_accepted"
        | "estimate_declined"
        | "estimate_expired"
        | "job_created"
        | "job_status_changed"
        | "invoice_created"
        | "invoice_synced"
        | "payment_received"
        | "task_completed"
        | "system"
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show"
      appointment_type:
        | "inspection"
        | "estimate_presentation"
        | "job_work"
        | "other"
      email_status: "pending" | "sent" | "failed"
      estimate_status:
        | "draft"
        | "sent"
        | "viewed"
        | "accepted"
        | "declined"
        | "expired"
        | "void"
      file_category:
        | "photo"
        | "measurement_report"
        | "estimate"
        | "contract"
        | "permit"
        | "insurance"
        | "invoice"
        | "other"
      integration_provider: "google_calendar" | "quickbooks"
      invoice_kind: "deposit" | "final"
      invoice_status: "draft" | "sent" | "partially_paid" | "paid" | "void"
      job_status:
        | "pending_schedule"
        | "scheduled"
        | "in_progress"
        | "on_hold"
        | "completed"
        | "cancelled"
      lead_channel: "website" | "google_ads" | "manual" | "import"
      lead_submission_status:
        | "received"
        | "created"
        | "merged_duplicate"
        | "rejected"
        | "error"
      lost_reason:
        | "price"
        | "competitor"
        | "no_response"
        | "not_qualified"
        | "insurance_denied"
        | "timing"
        | "duplicate"
        | "other"
      opportunity_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "inspection_scheduled"
        | "estimate_sent"
        | "negotiation"
        | "won"
        | "lost"
      outbox_status: "pending" | "processing" | "done" | "failed"
      permit_status:
        | "not_required"
        | "needed"
        | "applied"
        | "approved"
        | "closed"
      sync_status: "not_synced" | "pending" | "synced" | "error"
      task_status: "open" | "done" | "cancelled"
      user_role: "admin" | "sales" | "field"
      work_type:
        | "roof_replacement"
        | "roof_repair"
        | "renovation"
        | "gutters"
        | "siding"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_type: [
        "lead_received",
        "duplicate_inquiry",
        "call",
        "email",
        "sms",
        "note_added",
        "stage_changed",
        "owner_changed",
        "deal_won",
        "deal_lost",
        "deal_reopened",
        "appointment_scheduled",
        "appointment_rescheduled",
        "appointment_completed",
        "appointment_cancelled",
        "files_uploaded",
        "estimate_created",
        "estimate_sent",
        "estimate_viewed",
        "estimate_accepted",
        "estimate_declined",
        "estimate_expired",
        "job_created",
        "job_status_changed",
        "invoice_created",
        "invoice_synced",
        "payment_received",
        "task_completed",
        "system",
      ],
      appointment_status: ["scheduled", "completed", "cancelled", "no_show"],
      appointment_type: [
        "inspection",
        "estimate_presentation",
        "job_work",
        "other",
      ],
      email_status: ["pending", "sent", "failed"],
      estimate_status: [
        "draft",
        "sent",
        "viewed",
        "accepted",
        "declined",
        "expired",
        "void",
      ],
      file_category: [
        "photo",
        "measurement_report",
        "estimate",
        "contract",
        "permit",
        "insurance",
        "invoice",
        "other",
      ],
      integration_provider: ["google_calendar", "quickbooks"],
      invoice_kind: ["deposit", "final"],
      invoice_status: ["draft", "sent", "partially_paid", "paid", "void"],
      job_status: [
        "pending_schedule",
        "scheduled",
        "in_progress",
        "on_hold",
        "completed",
        "cancelled",
      ],
      lead_channel: ["website", "google_ads", "manual", "import"],
      lead_submission_status: [
        "received",
        "created",
        "merged_duplicate",
        "rejected",
        "error",
      ],
      lost_reason: [
        "price",
        "competitor",
        "no_response",
        "not_qualified",
        "insurance_denied",
        "timing",
        "duplicate",
        "other",
      ],
      opportunity_stage: [
        "new",
        "contacted",
        "qualified",
        "inspection_scheduled",
        "estimate_sent",
        "negotiation",
        "won",
        "lost",
      ],
      outbox_status: ["pending", "processing", "done", "failed"],
      permit_status: [
        "not_required",
        "needed",
        "applied",
        "approved",
        "closed",
      ],
      sync_status: ["not_synced", "pending", "synced", "error"],
      task_status: ["open", "done", "cancelled"],
      user_role: ["admin", "sales", "field"],
      work_type: [
        "roof_replacement",
        "roof_repair",
        "renovation",
        "gutters",
        "siding",
        "other",
      ],
    },
  },
} as const

