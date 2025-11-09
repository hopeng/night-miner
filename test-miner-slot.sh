#!/bin/bash
# Test script for miner-slot.gs API
# Tests all operations: status, acquire, renew, release

BASE_URL="https://script.google.com/macros/s/AKfycbxiE_MP2P2gW9laIsCXAuW7ba-OHC2lTWL0V9OM8_eV0Kgki7c9n-nhQdZCKrj_bEo4LA/exec"
TOKEN="uzigPjtquxgsQgXE5oSRQLABN8JHtuem"
MACHINE="TEST_MACHINE"

# Color output for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0

# Helper function to make API calls
call_api() {
    local params="$1"
    local expected="$2"
    local description="$3"

    test_count=$((test_count + 1))
    echo ""
    echo -e "${YELLOW}Test $test_count: $description${NC}"

    # Add machine parameter if not already present
    if [[ ! "$params" =~ machine= ]]; then
        params="$params&machine=$MACHINE"
    fi

    echo "Calling: $BASE_URL?$params"

    response=$(curl -sL --ssl-no-revoke "$BASE_URL?$params")
    echo "Response: $response"

    # Check if response is empty
    if [[ -z "$response" ]]; then
        echo -e "${RED}✗ FAIL - Empty response (check network or URL)${NC}"
        return
    fi

    # Extract just the JSON (Google Apps Script may include HTML wrapper)
    # Try to find JSON pattern
    json_response=$(echo "$response" | grep -o '{.*}' | head -1)
    if [[ -n "$json_response" ]]; then
        response="$json_response"
    fi

    echo "Expected: $expected"

    # Use jq for JSON comparison if available, otherwise string comparison
    if command -v jq &> /dev/null; then
        # Normalize both JSON strings for comparison
        response_normalized=$(echo "$response" | jq -c -S '.')
        expected_normalized=$(echo "$expected" | jq -c -S '.')

        if [[ "$response_normalized" == "$expected_normalized" ]]; then
            echo -e "${GREEN}✓ PASS${NC}"
            pass_count=$((pass_count + 1))
        else
            echo -e "${RED}✗ FAIL${NC}"
        fi
    else
        # Fallback to string comparison
        if [[ "$response" == "$expected" ]]; then
            echo -e "${GREEN}✓ PASS${NC}"
            pass_count=$((pass_count + 1))
        else
            echo -e "${RED}✗ FAIL (install jq for better comparison)${NC}"
        fi
    fi
}

echo "========================================"
echo "  Miner Slot API Test Suite"
echo "========================================"

# Test 1: Check initial status (should be empty or have existing leases) - no machine param
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"machine":"TEST_MACHINE","count":0,"ids":[]}' \
    "Initial status check (expecting empty, no machine param)"

# Test 2: Acquire first slot (test1)
call_api "token=$TOKEN&op=acquire&id=test1" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":1,"ids":["test1"]}' \
    "Acquire first slot (test1)"

# Test 3: Acquire second slot (test2)
call_api "token=$TOKEN&op=acquire&id=test2" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":2,"ids":["test1","test2"]}' \
    "Acquire second slot (test2)"

# Test 4: Acquire third slot (test3) - should fail with default max=2
call_api "token=$TOKEN&op=acquire&id=test3" \
    '{"ok":true,"granted":false,"machine":"TEST_MACHINE","count":2,"reason":"machine_limit","ids":["test1","test2"]}' \
    "Acquire third slot (should be denied with max=2)"

# Test 5: Check status with machine param (specific machine)
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"machine":"TEST_MACHINE","count":2,"ids":["test1","test2"]}' \
    "Status check with machine param (specific machine)"

# Test 6: Try to acquire 3rd slot (should be denied - max=2 by default)
call_api "token=$TOKEN&op=acquire&id=test3" \
    '{"ok":true,"granted":false,"machine":"TEST_MACHINE","count":2,"reason":"machine_limit","ids":["test1","test2"]}' \
    "Attempt to acquire 3rd slot (should be denied with default max=2)"

# Test 6b: Try to acquire 3rd slot with max=3 (should be granted)
call_api "token=$TOKEN&op=acquire&id=test3&max=3" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test3"]}' \
    "Acquire 3rd slot with max=3 (should be granted)"

# Test 7: Re-acquire existing slot (test1) - should renew, not add new
call_api "token=$TOKEN&op=acquire&id=test1&max=3" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test3"]}' \
    "Re-acquire existing slot test1 (should renew, count stays 3)"

# Test 8: Renew an existing lease (test2)
call_api "token=$TOKEN&op=renew&id=test2" \
    '{"ok":true,"renewed":true,"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test3"]}' \
    "Renew existing lease (test2)"

# Test 9: Release one slot (test3)
call_api "token=$TOKEN&op=release&id=test3" \
    '{"ok":true,"released":true,"machine":"TEST_MACHINE","count":2,"ids":["test1","test2"]}' \
    "Release slot test3"

# Test 10: Check status with machine param after release
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"machine":"TEST_MACHINE","count":2,"ids":["test1","test2"]}' \
    "Status check with machine param after releasing test3"

# Test 11: Acquire new slot after release (test4 should now work)
call_api "token=$TOKEN&op=acquire&id=test4&max=3" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test4"]}' \
    "Acquire test4 after releasing test3"

# Test 11b: Check status without machine param (global view)
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"total_slots":3,"machines":[{"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test4"]}]}' \
    "Status check without machine param (global view)"

# Test 11c: List all machines (new endpoint - no machine param)
call_api "token=$TOKEN&op=list_machines" \
    '{"ok":true,"total_slots":3,"machines":[{"machine":"TEST_MACHINE","count":3,"ids":["test1","test2","test4"]}]}' \
    "List all machines with their slot counts"

# Test 12: Test with invalid token (should fail)
call_api "token=invalid&op=status" \
    '{"ok":false,"error":"bad token"}' \
    "Invalid token (should fail)"

# Test 13: Test with unknown operation
call_api "token=$TOKEN&op=invalid" \
    '{"ok":false,"error":"unknown op"}' \
    "Unknown operation (should fail)"

# Test 14: Test with full slots (trying to acquire when 3 are occupied with default max=2)
call_api "token=$TOKEN&op=acquire&id=test5" \
    '{"ok":true,"granted":false,"machine":"TEST_MACHINE","count":3,"reason":"machine_limit","ids":["test1","test2","test4"]}' \
    "Acquire with slots full (should be denied with default max=2)"

# Test 15: Release all slots at once (per-machine release_all operation)
call_api "token=$TOKEN&op=release_all" \
    '{"ok":true,"released_all":true,"machine":"TEST_MACHINE","count":0,"ids":[]}' \
    "Cleanup: Release all slots for this machine"

# Test 16: Verify slots were released with status (no machine param - global view)
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"total_slots":0,"machines":[]}' \
    "Verify machine slots are empty (global view)"

# Test 17: Acquire slots again for testing
call_api "token=$TOKEN&op=acquire&id=test6&max=3" \
    '{"ok":true,"granted":true,"machine":"TEST_MACHINE","count":1,"ids":["test6"]}' \
    "Acquire test6"

# Test 18: Final status check after test6
call_api "token=$TOKEN&op=status" \
    '{"ok":true,"machine":"TEST_MACHINE","count":1,"ids":["test6"]}' \
    "Final status check (should have test6)"

echo ""
echo "========================================"
echo -e "  Results: ${GREEN}$pass_count${NC}/$test_count tests passed"
echo "========================================"
echo ""
echo "Note: Test data (TEST_MACHINE slots) left in place."
echo "To clean up manually, run:"
echo "curl \"$BASE_URL?token=$TOKEN&op=release_all&machine=$MACHINE\""
