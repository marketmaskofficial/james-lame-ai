ALTER TABLE public.trade_executions ADD COLUMN broker_execution_id text;
CREATE UNIQUE INDEX trade_executions_broker_exec_idx
  ON public.trade_executions (account_id, broker_execution_id)
  WHERE broker_execution_id IS NOT NULL;