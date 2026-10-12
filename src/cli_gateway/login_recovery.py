"""Stopped login recovery; never replays stdin or restores ephemeral crypto keys."""
from .contracts import GatewayError


def names(session_id):
    import uuid
    value = str(uuid.UUID(session_id))
    if value != session_id:
        raise GatewayError("INVALID_OUTPUT")
    return ("cli-login-" + value + "-auth", "cli-login-" + value + "-verify")


def recover_login(engine, client, journal):
    local = journal.load()
    assigned = client.call("getLoginAssignment").get("login")
    if not local and not assigned:
        return
    if local and assigned and local["sessionId"] != assigned["sessionId"]:
        client.call("quarantineHost")
        raise GatewayError("ASSIGNMENT_MISMATCH")
    attempt = local or assigned
    allowed = set(names(attempt["sessionId"]))
    inventory = engine.inventory()  # Failure must not count as an empty inventory.
    unexpected = set(inventory) - allowed
    for name in inventory:
        engine.stop(name)
    if unexpected:
        client.call("quarantineHost")
        raise GatewayError("UNKNOWN_CONTAINER")
    receipt = client.call("reconcileLogin", sessionId=attempt["sessionId"], stopped=True)
    if not receipt.get("acknowledged"):
        raise GatewayError("STOP_UNCONFIRMED")
    for name in inventory:
        engine.remove(name)
    journal.clear()
