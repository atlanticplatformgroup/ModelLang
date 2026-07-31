-- Example-only deterministic seed. Demo login roles must exist before applying this file.
SET ROLE modellang_owner;

INSERT INTO "model_reservations"."user" ("id", "name") VALUES
  ('10000000-0000-4000-8000-000000000001', 'Reserver One'),
  ('10000000-0000-4000-8000-000000000002', 'Reserver Two');

INSERT INTO "model_reservations"."resource" ("id", "name") VALUES
  ('20000000-0000-4000-8000-000000000001', 'Conference Room A'),
  ('20000000-0000-4000-8000-000000000002', 'Conference Room B');

INSERT INTO "model_reservations_internal"."principal_binding" ("database_principal", "principal_id") VALUES
  ('ml_reserver_one', '10000000-0000-4000-8000-000000000001'),
  ('ml_reserver_two', '10000000-0000-4000-8000-000000000002');

INSERT INTO "model_reservations_internal"."gateway_principal_binding" ("issuer", "subject", "principal_id") VALUES
  ('https://auth.example.test', 'reserver-one', '10000000-0000-4000-8000-000000000001'),
  ('https://auth.example.test', 'reserver-two', '10000000-0000-4000-8000-000000000002');

RESET ROLE;
