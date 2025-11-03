.data
# Source data buffer (4 words = 16 bytes)
source_data:
    .word 0x12345678, 0xABCDEF01, 0x11223344, 0x55667788

# Destination buffer (4 words, initially zero)
dest_data:
    .word 0x00000000, 0x00000000, 0x00000000, 0x00000000

# Status messages
start_msg:    .asciiz "DMA Test: Moving 4 words (16 bytes)\n"
config_msg:   .asciiz "Setting up DMA...\n"
wait_msg:     .asciiz "Waiting for transfer...\n"
done_msg:     .asciiz "Transfer complete!\n"
verify_msg:   .asciiz "Checking results:\n"
pass_msg:     .asciiz "SUCCESS: All data transferred correctly!\n"
fail_msg:     .asciiz "FAILED: Data mismatch detected!\n"

.text
main:
    # Print start message
    la a0, start_msg
    li a7, 4
    ecall

    # Show original data
    la a0, config_msg
    li a7, 4
    ecall
    
    # DMA configuration will be written directly to registers
    
    # Configure DMA controller
    li t2, 0xFFED0000        # DMA base address
    
    # Write descriptor words to DESC register (0xFFED0004)
    # Word 1: Source address
    la t1, source_data
    sw t1, 4(t2)             # Write source address
    
    # Word 2: Destination address  
    la t1, dest_data
    sw t1, 4(t2)             # Write destination address
    
    # Word 3: Configuration word
    # For byte mode: 16 elements = 16 bytes
    # Format: [31:30]=dst_mode, [29:28]=src_mode, [27]=bswap, [23:0]=elements
    li t1, 2                 # dst_mode = 2 (increment byte)
    slli t1, t1, 30          # dst_mode in bits 31:30
    li t3, 2                 # src_mode = 2 (increment byte)  
    slli t3, t3, 28          # src_mode in bits 29:28
    or t1, t1, t3            # Combine modes
    ori t1, t1, 16           # Add 16 elements in bits 23:0
    sw t1, 4(t2)             # Write configuration
    
    # Start transfer
    li t1, 3                 # Enable (bit 0) + Start (bit 1)
    sw t1, 0(t2)             # 0xFFED0000 = CTRL register
    
    # Wait for completion
    la a0, wait_msg
    li a7, 4
    ecall

wait_loop:
    lw t1, 0(t2)             # Read CTRL register
    li t3, 0x40000000        # Bit 30 mask (DMA_CTRL_DONE)
    and t4, t1, t3           # Check done bit (specification compliant)
    beqz t4, wait_loop       # Loop until done
    
    # Transfer completed
    la a0, done_msg
    li a7, 4
    ecall
    
    # Verify transfer
    la a0, verify_msg
    li a7, 4
    ecall
    
    # Check 4 words
    la t0, source_data
    la t1, dest_data
    li t2, 4                 # 4 words to check

check_loop:
    lw t3, 0(t0)             # Load source word
    lw t4, 0(t1)             # Load dest word
    
    # Print debug info (optional)
    # mv a0, t3
    # li a7, 34               # Print hex
    # ecall
    
    bne t3, t4, failed       # Jump if mismatch
    
    addi t0, t0, 4           # Next source word
    addi t1, t1, 4           # Next dest word
    addi t2, t2, -1          # Decrement counter
    bnez t2, check_loop      # Continue if more words

    # All checks passed
    la a0, pass_msg
    li a7, 4
    ecall
    j exit

failed:
    la a0, fail_msg
    li a7, 4
    ecall

exit:
    li a7, 93                # Exit
    li a0, 0
    ecall