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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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

