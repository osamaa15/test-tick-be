export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
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
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          topic: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          topic: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          topic?: string
        }
        Relationships: []
      }
      feature_views: {
        Row: {
          feature_id: string
          sync_id: string
          user_id: string
        }
        Insert: {
          feature_id: string
          sync_id: string
          user_id: string
        }
        Update: {
          feature_id?: string
          sync_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_views_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_views_sync_id_fkey"
            columns: ["sync_id"]
            isOneToOne: false
            referencedRelation: "syncs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          code_hash: string | null
          created_at: string
          description: string
          id: string
          name: string
          paths: string[]
          project_id: string
        }
        Insert: {
          code_hash?: string | null
          created_at?: string
          description: string
          id?: string
          name: string
          paths?: string[]
          project_id: string
        }
        Update: {
          code_hash?: string | null
          created_at?: string
          description?: string
          id?: string
          name?: string
          paths?: string[]
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "features_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          connected_by: string | null
          created_at: string
          default_branch: string
          id: string
          name: string
          owner: string
          provider: string
          provider_repo_id: string
          resync: boolean
          visibility: string
        }
        Insert: {
          connected_by?: string | null
          created_at?: string
          default_branch: string
          id?: string
          name: string
          owner: string
          provider: string
          provider_repo_id: string
          resync?: boolean
          visibility: string
        }
        Update: {
          connected_by?: string | null
          created_at?: string
          default_branch?: string
          id?: string
          name?: string
          owner?: string
          provider?: string
          provider_repo_id?: string
          resync?: boolean
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_tokens: {
        Row: {
          access_token: string
          access_token_expires_at: string | null
          refresh_token: string | null
          refresh_token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          access_token_expires_at?: string | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string | null
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          created_at: string
          expected: string
          feature_id: string
          id: string
          kind: string
          marked_at: string | null
          marked_by: string | null
          origin: string
          preconditions: string | null
          role: string
          seq: number
          steps: string[]
          title: string
          verdict: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          expected: string
          feature_id: string
          id?: string
          kind: string
          marked_at?: string | null
          marked_by?: string | null
          origin: string
          preconditions?: string | null
          role: string
          seq?: never
          steps?: string[]
          title: string
          verdict?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          expected?: string
          feature_id?: string
          id?: string
          kind?: string
          marked_at?: string | null
          marked_by?: string | null
          origin?: string
          preconditions?: string | null
          role?: string
          seq?: never
          steps?: string[]
          title?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenarios_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenarios_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenarios_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          expires_at: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_features: {
        Row: {
          change: string | null
          feature_id: string
          scenarios: Json | null
          sync_id: string
        }
        Insert: {
          change?: string | null
          feature_id: string
          scenarios?: Json | null
          sync_id: string
        }
        Update: {
          change?: string | null
          feature_id?: string
          scenarios?: Json | null
          sync_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_features_sync_id_fkey"
            columns: ["sync_id"]
            isOneToOne: false
            referencedRelation: "syncs"
            referencedColumns: ["id"]
          },
        ]
      }
      syncs: {
        Row: {
          attempts: number
          branch: string
          claimed_at: string | null
          commit_author: string | null
          commit_message: string | null
          commit_sha: string | null
          failure: string | null
          finished_at: string | null
          id: string
          project_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempts?: number
          branch: string
          claimed_at?: string | null
          commit_author?: string | null
          commit_message?: string | null
          commit_sha?: string | null
          failure?: string | null
          finished_at?: string | null
          id?: string
          project_id: string
          started_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          branch?: string
          claimed_at?: string | null
          commit_author?: string | null
          commit_message?: string | null
          commit_sha?: string | null
          failure?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "syncs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          provider: string
          provider_user_id: string
          role: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name: string
          provider: string
          provider_user_id: string
          role?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name?: string
          provider?: string
          provider_user_id?: string
          role?: string | null
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_sync: {
        Args: never
        Returns: {
          attempts: number
          branch: string
          claimed_at: string | null
          commit_author: string | null
          commit_message: string | null
          commit_sha: string | null
          failure: string | null
          finished_at: string | null
          id: string
          project_id: string
          started_at: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "syncs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      connect_projects: {
        Args: { p_repos: Json; p_user_id: string }
        Returns: undefined
      }
      fail_sync: {
        Args: { p_attempt: number; p_failure: string; p_sync_id: string }
        Returns: boolean
      }
      feature_summaries: {
        Args: { p_project_ids: string[]; p_user_id: string }
        Returns: {
          change: string
          description: string
          developer_failed: number
          developer_passed: number
          developer_total: number
          id: string
          name: string
          project_id: string
          tester_failed: number
          tester_passed: number
          tester_total: number
        }[]
      }
      finish_sync: {
        Args: { p_attempt: number; p_features: Json; p_sync_id: string }
        Returns: boolean
      }
      open_feature: {
        Args: { p_feature_id: string; p_user_id: string }
        Returns: string
      }
      project_summaries: {
        Args: { p_repo_ids: string[]; p_user_id: string }
        Returns: {
          developer_failed: number
          developer_passed: number
          developer_total: number
          feature_count: number
          id: string
          latest_commit_sha: string
          latest_started_at: string
          latest_status: string
          new_feature_count: number
          provider_repo_id: string
          tester_failed: number
          tester_passed: number
          tester_total: number
        }[]
      }
      replace_ai_scenarios: {
        Args: { p_feature_id: string; p_role: string; p_scenarios: Json }
        Returns: undefined
      }
      request_sync: {
        Args: { p_branch: string; p_project_id: string }
        Returns: undefined
      }
      start_requested_sync: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      sync_history: {
        Args: { p_project_id: string }
        Returns: {
          branch: string
          commit_author: string
          commit_message: string
          commit_sha: string
          failure: string
          features: Json
          id: string
          is_current: boolean
          started_at: string
          status: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {},
  },
} as const
