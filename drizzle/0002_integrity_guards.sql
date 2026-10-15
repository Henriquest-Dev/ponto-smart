-- Garantias de integridade que não dependem da aplicação.

-- 1) Execuções salariais aprovadas são imutáveis (itens e linhas).
CREATE OR REPLACE FUNCTION ps_guard_payroll_immutable() RETURNS trigger AS $$
DECLARE
  v_status payroll_run_status;
BEGIN
  IF TG_TABLE_NAME = 'payroll_items' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = OLD.run_id;
  ELSE
    SELECT r.status INTO v_status
      FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
     WHERE i.id = OLD.payroll_item_id;
  END IF;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'Execução salarial aprovada é imutável (%).', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_items_immutable BEFORE UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION ps_guard_payroll_immutable();
--> statement-breakpoint
CREATE TRIGGER payroll_lines_immutable BEFORE UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION ps_guard_payroll_immutable();
--> statement-breakpoint

-- 2) Trilho de auditoria apenas de acréscimo.
CREATE OR REPLACE FUNCTION ps_guard_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é apenas de acréscimo.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ps_guard_append_only();
--> statement-breakpoint

-- 3) Coerência das vigências.
ALTER TABLE salary_agreements ADD CONSTRAINT salary_agreements_dates_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
--> statement-breakpoint
ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_dates_chk CHECK (end_date >= start_date);
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_month_chk CHECK (month BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE schedule_rules ADD CONSTRAINT schedule_rules_weekday_chk CHECK (weekday BETWEEN 1 AND 7);
--> statement-breakpoint
ALTER TABLE work_locations ADD CONSTRAINT work_locations_radius_chk CHECK (radius_m BETWEEN 5 AND 5000);
