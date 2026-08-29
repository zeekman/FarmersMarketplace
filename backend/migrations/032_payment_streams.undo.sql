-- Undo: 032_payment_streams
DROP INDEX IF EXISTS idx_payment_streams_recipient;
DROP INDEX IF EXISTS idx_payment_streams_sender;
DROP INDEX IF EXISTS idx_payment_streams_contract_stream;
DROP TABLE IF EXISTS payment_streams;
