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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_notifications: {
        Row: {
          alert_id: string
          condition: string
          id: string
          read: boolean
          symbol: string
          threshold: number
          triggered_at: string
          triggered_price: number
          user_id: string
        }
        Insert: {
          alert_id: string
          condition: string
          id?: string
          read?: boolean
          symbol: string
          threshold: number
          triggered_at?: string
          triggered_price: number
          user_id: string
        }
        Update: {
          alert_id?: string
          condition?: string
          id?: string
          read?: boolean
          symbol?: string
          threshold?: number
          triggered_at?: string
          triggered_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          active: boolean
          condition: string
          cooldown_seconds: number
          created_at: string
          id: string
          last_triggered_at: string | null
          symbol: string
          threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          condition: string
          cooldown_seconds?: number
          created_at?: string
          id?: string
          last_triggered_at?: string | null
          symbol: string
          threshold: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          condition?: string
          cooldown_seconds?: number
          created_at?: string
          id?: string
          last_triggered_at?: string | null
          symbol?: string
          threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      broker_audit_log: {
        Row: {
          account_id: string | null
          action: string
          broker: string
          broker_account_id: string | null
          broker_order_id: string | null
          created_at: string
          environment: string
          id: string
          message: string | null
          order_id: string | null
          request: Json
          response: Json
          result: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          action: string
          broker: string
          broker_account_id?: string | null
          broker_order_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          message?: string | null
          order_id?: string | null
          request?: Json
          response?: Json
          result?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          action?: string
          broker?: string
          broker_account_id?: string | null
          broker_order_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          message?: string | null
          order_id?: string | null
          request?: Json
          response?: Json
          result?: string
          user_id?: string
        }
        Relationships: []
      }
      broker_connections: {
        Row: {
          broker: string
          broker_user_id: string | null
          created_at: string
          credentials_encrypted: string | null
          environment: string
          id: string
          label: string
          last_connected_at: string | null
          last_error: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          broker?: string
          broker_user_id?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          environment?: string
          id?: string
          label?: string
          last_connected_at?: string | null
          last_error?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          broker?: string
          broker_user_id?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          environment?: string
          id?: string
          label?: string
          last_connected_at?: string | null
          last_error?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chart_drawings: {
        Row: {
          created_at: string
          drawings: Json
          id: string
          layout: string
          symbol: string
          timeframe: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          drawings?: Json
          id?: string
          layout?: string
          symbol: string
          timeframe: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          drawings?: Json
          id?: string
          layout?: string
          symbol?: string
          timeframe?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          app_version: string | null
          category: string
          created_at: string
          id: string
          message: string
          page: string | null
          project_id: string | null
          symbol: string | null
          timeframe: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          category: string
          created_at?: string
          id?: string
          message: string
          page?: string | null
          project_id?: string | null
          symbol?: string | null
          timeframe?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          page?: string | null
          project_id?: string | null
          symbol?: string | null
          timeframe?: string | null
          user_id?: string
        }
        Relationships: []
      }
      indicator_versions: {
        Row: {
          changelog: string
          code: string
          created_at: string
          id: string
          indicator_id: string
          is_overlay: boolean
          name: string
          pine: string
          settings: Json
          spec: Json
          user_id: string
          version: number
        }
        Insert: {
          changelog?: string
          code?: string
          created_at?: string
          id?: string
          indicator_id: string
          is_overlay?: boolean
          name?: string
          pine?: string
          settings?: Json
          spec?: Json
          user_id: string
          version: number
        }
        Update: {
          changelog?: string
          code?: string
          created_at?: string
          id?: string
          indicator_id?: string
          is_overlay?: boolean
          name?: string
          pine?: string
          settings?: Json
          spec?: Json
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "indicator_versions_indicator_id_fkey"
            columns: ["indicator_id"]
            isOneToOne: false
            referencedRelation: "indicators"
            referencedColumns: ["id"]
          },
        ]
      }
      indicators: {
        Row: {
          code: string
          created_at: string
          current_version: number
          id: string
          is_overlay: boolean
          kind: string
          name: string
          pine: string
          settings: Json
          spec: Json
          symbol: string | null
          timeframe: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string
          created_at?: string
          current_version?: number
          id?: string
          is_overlay?: boolean
          kind?: string
          name?: string
          pine?: string
          settings?: Json
          spec?: Json
          symbol?: string | null
          timeframe?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          current_version?: number
          id?: string
          is_overlay?: boolean
          kind?: string
          name?: string
          pine?: string
          settings?: Json
          spec?: Json
          symbol?: string | null
          timeframe?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          account_id: string | null
          chart_state: Json
          created_at: string
          entry_price: number | null
          exit_price: number | null
          id: string
          indicator_name: string | null
          notes: string
          position_id: string | null
          qty: number | null
          realized_pnl: number | null
          session: string | null
          side: string | null
          signal_id: string | null
          symbol: string
          timeframe: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          chart_state?: Json
          created_at?: string
          entry_price?: number | null
          exit_price?: number | null
          id?: string
          indicator_name?: string | null
          notes?: string
          position_id?: string | null
          qty?: number | null
          realized_pnl?: number | null
          session?: string | null
          side?: string | null
          signal_id?: string | null
          symbol: string
          timeframe?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          chart_state?: Json
          created_at?: string
          entry_price?: number | null
          exit_price?: number | null
          id?: string
          indicator_name?: string | null
          notes?: string
          position_id?: string | null
          qty?: number | null
          realized_pnl?: number | null
          session?: string | null
          side?: string | null
          signal_id?: string | null
          symbol?: string
          timeframe?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "trade_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          script_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          script_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_events: {
        Row: {
          created_at: string
          event: string
          id: string
          props: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          props?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          props?: Json
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      risk_settings: {
        Row: {
          confirm_live_orders: boolean
          disable_after_daily_loss: boolean
          max_daily_loss: number | null
          max_open_positions: number | null
          max_position_size: number | null
          max_risk_per_trade: number | null
          max_trades_per_day: number | null
          require_stop_loss: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          confirm_live_orders?: boolean
          disable_after_daily_loss?: boolean
          max_daily_loss?: number | null
          max_open_positions?: number | null
          max_position_size?: number | null
          max_risk_per_trade?: number | null
          max_trades_per_day?: number | null
          require_stop_loss?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          confirm_live_orders?: boolean
          disable_after_daily_loss?: boolean
          max_daily_loss?: number | null
          max_open_positions?: number | null
          max_position_size?: number | null
          max_risk_per_trade?: number | null
          max_trades_per_day?: number | null
          require_stop_loss?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scripts: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_public: boolean
          prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          prompt?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          prompt?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trade_executions: {
        Row: {
          account_id: string
          broker_execution_id: string | null
          commission: number
          executed_at: string
          id: string
          liquidity: string
          order_id: string | null
          position_id: string | null
          price: number
          qty: number
          realized_pnl: number
          side: string
          symbol: string
          user_id: string
        }
        Insert: {
          account_id: string
          broker_execution_id?: string | null
          commission?: number
          executed_at?: string
          id?: string
          liquidity?: string
          order_id?: string | null
          position_id?: string | null
          price: number
          qty: number
          realized_pnl?: number
          side: string
          symbol: string
          user_id: string
        }
        Update: {
          account_id?: string
          broker_execution_id?: string | null
          commission?: number
          executed_at?: string
          id?: string
          liquidity?: string
          order_id?: string | null
          position_id?: string | null
          price?: number
          qty?: number
          realized_pnl?: number
          side?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_executions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_executions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "trade_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_executions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "trade_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_orders: {
        Row: {
          account_id: string
          avg_fill_price: number | null
          bracket_stop: number | null
          bracket_target: number | null
          broker_order_id: string | null
          broker_status: string | null
          client_tag: string | null
          created_at: string
          filled_qty: number
          id: string
          indicator_id: string | null
          indicator_name: string | null
          indicator_version: number | null
          limit_price: number | null
          order_type: string
          parent_order_id: string | null
          position_id: string | null
          purpose: string
          qty: number
          reduce_only: boolean
          reject_reason: string | null
          side: string
          signal_id: string | null
          status: string
          stop_price: number | null
          symbol: string
          time_in_force: string
          timeframe: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          avg_fill_price?: number | null
          bracket_stop?: number | null
          bracket_target?: number | null
          broker_order_id?: string | null
          broker_status?: string | null
          client_tag?: string | null
          created_at?: string
          filled_qty?: number
          id?: string
          indicator_id?: string | null
          indicator_name?: string | null
          indicator_version?: number | null
          limit_price?: number | null
          order_type: string
          parent_order_id?: string | null
          position_id?: string | null
          purpose?: string
          qty: number
          reduce_only?: boolean
          reject_reason?: string | null
          side: string
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          symbol: string
          time_in_force?: string
          timeframe?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          avg_fill_price?: number | null
          bracket_stop?: number | null
          bracket_target?: number | null
          broker_order_id?: string | null
          broker_status?: string | null
          client_tag?: string | null
          created_at?: string
          filled_qty?: number
          id?: string
          indicator_id?: string | null
          indicator_name?: string | null
          indicator_version?: number | null
          limit_price?: number | null
          order_type?: string
          parent_order_id?: string | null
          position_id?: string | null
          purpose?: string
          qty?: number
          reduce_only?: boolean
          reject_reason?: string | null
          side?: string
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          symbol?: string
          time_in_force?: string
          timeframe?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "trading_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "trade_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_orders_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "trade_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_positions: {
        Row: {
          account_id: string
          avg_entry: number
          broker_position_id: string | null
          close_lock_at: string | null
          closed_at: string | null
          id: string
          indicator_id: string | null
          indicator_name: string | null
          indicator_version: number | null
          opened_at: string
          qty: number
          realized_pnl: number
          side: string
          signal_id: string | null
          status: string
          stop_price: number | null
          symbol: string
          target_price: number | null
          timeframe: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          avg_entry?: number
          broker_position_id?: string | null
          close_lock_at?: string | null
          closed_at?: string | null
          id?: string
          indicator_id?: string | null
          indicator_name?: string | null
          indicator_version?: number | null
          opened_at?: string
          qty?: number
          realized_pnl?: number
          side: string
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          symbol: string
          target_price?: number | null
          timeframe?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          avg_entry?: number
          broker_position_id?: string | null
          close_lock_at?: string | null
          closed_at?: string | null
          id?: string
          indicator_id?: string | null
          indicator_name?: string | null
          indicator_version?: number | null
          opened_at?: string
          qty?: number
          realized_pnl?: number
          side?: string
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          symbol?: string
          target_price?: number | null
          timeframe?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "trading_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_accounts: {
        Row: {
          account_number: string
          balance: number
          broker: string
          broker_account_id: string | null
          broker_account_spec: string | null
          buying_power: number | null
          commission_per_unit: number
          connection_id: string | null
          created_at: string
          currency: string
          environment: string
          equity: number | null
          id: string
          is_default: boolean
          label: string
          realized_pnl: number
          starting_balance: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_number?: string
          balance?: number
          broker?: string
          broker_account_id?: string | null
          broker_account_spec?: string | null
          buying_power?: number | null
          commission_per_unit?: number
          connection_id?: string | null
          created_at?: string
          currency?: string
          environment?: string
          equity?: number | null
          id?: string
          is_default?: boolean
          label?: string
          realized_pnl?: number
          starting_balance?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_number?: string
          balance?: number
          broker?: string
          broker_account_id?: string | null
          broker_account_spec?: string | null
          buying_power?: number | null
          commission_per_unit?: number
          connection_id?: string | null
          created_at?: string
          currency?: string
          environment?: string
          equity?: number | null
          id?: string
          is_default?: boolean
          label?: string
          realized_pnl?: number
          starting_balance?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "broker_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlists: {
        Row: {
          created_at: string
          id: string
          label: string | null
          position: number
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          position?: number
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          position?: number
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
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
  public: {
    Enums: {},
  },
} as const
