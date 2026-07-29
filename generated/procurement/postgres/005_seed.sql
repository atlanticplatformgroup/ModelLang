-- Example-only deterministic seed. Demo login roles must exist before applying this file.
SET ROLE modellang_owner;

INSERT INTO "model_procurement"."user" ("id", "name", "role") VALUES
  ('00000000-0000-4000-8000-000000000001', 'Employee One', 'EMPLOYEE'),
  ('00000000-0000-4000-8000-000000000002', 'Employee Two', 'EMPLOYEE'),
  ('00000000-0000-4000-8000-000000000003', 'Manager', 'MANAGER'),
  ('00000000-0000-4000-8000-000000000004', 'Finance', 'FINANCE');

INSERT INTO "model_procurement_internal"."principal_binding" ("database_principal", "principal_id") VALUES
  ('ml_employee_one', '00000000-0000-4000-8000-000000000001'),
  ('ml_employee_two', '00000000-0000-4000-8000-000000000002'),
  ('ml_manager', '00000000-0000-4000-8000-000000000003'),
  ('ml_finance', '00000000-0000-4000-8000-000000000004');

RESET ROLE;
