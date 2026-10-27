# Known readiness issues

The application is under development. The readiness audit identified these unresolved workflows:

1. Retrying an order status update can advance the kitchen state twice.
2. New orders can be accepted after the daily cash close although payments are blocked.
3. Cancelling an unpaid order can change sales for a closed business day.
4. Returning legacy stock without cost history can assign the current cost instead of preserving an unknown cost.
5. Ingredient unit validation does not cover ingredients referenced only in menu modifiers.

Reproduce using an isolated in-memory test database:

```powershell
cd Backend
python -m pytest qa/completeness_audit.py -q --tb=short
```

The audit currently contains six failing cases (two paths for legacy stock returns). They are deliberately separate from the existing regression suite. Fix these cases before treating the application as ready for unattended restaurant operations.

Offline support stores drafts and cached views. Confirmed orders, stock updates and payments require the backend database connection. Real printer compatibility and off-machine backups require separate configuration and verification.
