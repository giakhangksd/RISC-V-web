const registerMapping = {
    '$ZERO': ['X0', 'ZERO'], '$RA': ['X1', 'RA'], '$SP': ['X2', 'SP'], '$GP': ['X3', 'GP'], '$TP': ['X4', 'TP'], '$T0': ['X5', 'T0'],
    '$T1': ['X6', 'T1'], '$T2': ['X7', 'T2'], '$S0': ['X8', 'S0', '$FP', 'FP'], '$FP': ['X8', 'S0', '$FP', 'FP'], '$S1': ['X9', 'S1'], '$A0': ['X10', 'A0'],
    '$A1': ['X11', 'A1'], '$A2': ['X12', 'A2'], '$A3': ['X13', 'A3'], '$A4': ['X14', 'A4'], '$A5': ['X15', 'A5'], '$A6': ['X16', 'A6'],
    '$A7': ['X17', 'A7'], '$S2': ['X18', 'S2'], '$S3': ['X19', 'S3'], '$S4': ['X20', 'S4'], '$S5': ['X21', 'S5'], '$S6': ['X22', 'S6'],
    '$S7': ['X23', 'S7'], '$S8': ['X24', 'S8'], '$S9': ['X25', 'S9'], '$S10': ['X26', 'S10'], '$S11': ['X27', 'S11'], '$T3': ['X28', 'T3'],
    '$T4': ['X29', 'T4'], '$T5': ['X30', 'T5'], '$T6': ['X31', 'T6']
};

function normalizeRegisterNames(instruction) {
    let normalizedInstruction = instruction;

    // Handle MIPS aliases with $ first
    for (const alias in registerMapping) {
        const riscvRegisters = registerMapping[alias];
        const regex = new RegExp(`\\${alias}`, 'gi');
        normalizedInstruction = normalizedInstruction.replace(regex, riscvRegisters[0]);
    }

    // Handle t0, t1, etc. (without $)
    for (const alias in registerMapping) {
        const riscvRegisters = registerMapping[alias];
        if (riscvRegisters.length > 1) { // Check if there's a non-$ alias
            const regex = new RegExp(`\\b${riscvRegisters[1]}\\b`, 'gi'); // \b for word boundaries
            normalizedInstruction = normalizedInstruction.replace(regex, riscvRegisters[0]);
        }
    }

    return normalizedInstruction;
}

function convertToBinary() {
    const instructionInput = document.getElementById('instructionInput').value;
    const binaryOutput = document.getElementById('binaryOutput');

    if (instructionInput.trim() === '') {
        binaryOutput.textContent = 'Please enter RISC-V assembly code.';
        return;
    }

    const instructions = instructionInput.split('\n');
    const binaryInstructions = instructions.map(instruction => {
        const binaryInstruction = riscvToBinary(instruction);
        return binaryInstruction ? `Binary: ${binaryInstruction}` : `Invalid: ${instruction}`;
    });

    binaryOutput.textContent = binaryInstructions.join('\n');
}

function riscvToBinary(instruction) {
    // Remove comments (everything after #)
    instruction = instruction.split('#')[0].trim();
    // Normalize register names
    instruction = normalizeRegisterNames(instruction);

    // Split the instruction into parts
    const parts = instruction.trim().toUpperCase().split(/[ ,]+/);

    // Validate that the instruction has at least 3 parts
    if (parts.length < 3 || parts.length > 4) {
        return null; // Invalid instruction format
    }

    const opcode = parts[0];
    const rd = parts[1];
    let rs1 = parts[2];
    let rs2 = parts.length === 4 && isNaN(parts[3]) ? parts[3] : null;
    let imm = parts.length === 4 ? parts[3] : null;


    // Handle `imm(rs1)` format
    const immRs1Match = rs1.match(/^(-?\d+)\((X\d+)\)$/); // Match `imm(rs1)` format
    if (immRs1Match) {
        imm = parseInt(immRs1Match[1], 10); // Extract immediate value
        rs1 = immRs1Match[2]; // Extract base register
    } else if (rs1.match(/^\(X\d+\)\d+$/)) {
        // Reject invalid format like `(X2)3`
        return null;
    }

    // Parse immediate value (handle both decimal and hexadecimal)
    if (imm && imm.toString().toLowerCase().startsWith('0x')) {
        imm = parseInt(imm, 16); // Parse as hexadecimal
    } else if (imm) {
        imm = parseInt(imm, 10); // Parse as decimal
    }

    // Validate that `imm` is a number for I-type instructions
    if (['ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI', 'JALR'].includes(opcode) && isNaN(imm)) {
        return null; // Invalid immediate value
    }

    function getRegisterNumber(register) {
        switch (register) {
            case 'X0': return '00000';
            case 'X1': return '00001';
            case 'X2': return '00010';
            case 'X3': return '00011';
            case 'X4': return '00100';
            case 'X5': return '00101';
            case 'X6': return '00110';
            case 'X7': return '00111';
            case 'X8': return '01000';
            case 'X9': return '01001';
            case 'X10': return '01010';
            case 'X11': return '01011';
            case 'X12': return '01100';
            case 'X13': return '01101';
            case 'X14': return '01110';
            case 'X15': return '01111';
            case 'X16': return '10000';
            case 'X17': return '10001';
            case 'X18': return '10010';
            case 'X19': return '10011';
            case 'X20': return '10100';
            case 'X21': return '10101';
            case 'X22': return '10110';
            case 'X23': return '10111';
            case 'X24': return '11000';
            case 'X25': return '11001';
            case 'X26': return '11010';
            case 'X27': return '11011';
            case 'X28': return '11100';
            case 'X29': return '11101';
            case 'X30': return '11110';
            case 'X31': return '11111';
            default: return null;
        }
    }
    const rdNum = getRegisterNumber(rd);
    const rs1Num = getRegisterNumber(rs1);
    const rs2Num = rs2 ? getRegisterNumber(rs2) : null;

    // Validate registers and immediate
    if (!rdNum || !rs1Num || (rs2 === null && imm === null )) {
        return null; // Invalid instruction
    }

    // Convert the immediate value to binary (sign-extend to 12 bits)
    const imm12 = imm !== null ? (imm & 0xFFF).toString(2).padStart(12, '0') : null;
    const imm5 = imm !== null ? (imm & 0x1F).toString(2).padStart(5, '0') : null;

    let binaryInstruction = '';
    switch (opcode) {
        //R-type
        case 'SLLI':
            binaryInstruction = `0000000 ${imm5} ${rs1Num} 001 ${rdNum} 0010011`;
            break;
        case 'SRLI':
            binaryInstruction = `0000000 ${imm5} ${rs1Num} 101 ${rdNum} 0010011`;
            break;
        case 'SRAI':
            binaryInstruction = `0000000 ${imm5} ${rs1Num} 001 ${rdNum} 0010011`;
            break;
        case 'ADD':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 000 ${rdNum} 0110011`;
            break;
        case 'SUB':
            if (!rs2Num) return null;
            binaryInstruction = `0100000 ${rs2Num} ${rs1Num} 000 ${rdNum} 0110011`;
            break;
        case 'SLL':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 001 ${rdNum} 0110011`;
            break;
        case 'SLT':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 010 ${rdNum} 0110011`;
            break;
        case 'SLTU':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 011 ${rdNum} 0110011`;
            break;
        case 'XOR':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 100 ${rdNum} 0110011`;
            break;
        case 'SRL':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 101 ${rdNum} 0110011`;
            break;
        case 'SRA':
            if (!rs2Num) return null;
            binaryInstruction = `0100000 ${rs2Num} ${rs1Num} 101 ${rdNum} 0110011`;
            break;
        case 'OR':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 110 ${rdNum} 0110011`;
            break;
        case 'AND':
            if (!rs2Num) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 111 ${rdNum} 0110011`;
            break;
         // I-type (load instructions)
         case 'JALR':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 000 ${rdNum} 1100111`;
            break;
         case 'LB':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 000 ${rdNum} 0000011`;
            break;
        case 'LH':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 001 ${rdNum} 0000011`;
            break;
        case 'LW':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 010 ${rdNum} 0000011`;
            break;
        case 'LBU':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 100 ${rdNum} 0000011`;
            break;
        case 'LHU':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 101 ${rdNum} 0000011`;
            break;
        // I-type (arithmetic and logical instructions)
        case 'ADDI':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 000 ${rdNum} 0010011`;
            break;
        case 'SLTI':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 010 ${rdNum} 0010011`;
            break;
        case 'SLTIU':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 011 ${rdNum} 0010011`;
            break;
        case 'XORI':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 100 ${rdNum} 0010011`;
            break;
        case 'ORI':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 110 ${rdNum} 0010011`;
            break;
        case 'ANDI':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 111 ${rdNum} 0010011`;
            break;
        // S-type (store instructions)
        case 'SB':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 000 ${rdNum} 0100011`;
            break;
        case 'SH':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 001 ${rdNum} 0100011`;
            break;
        case 'SW':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} 010 ${rdNum} 0100011`;
            break;
        // B-type (branch instructions)
        case 'BEQ':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 000 ${rdNum} 1100011`;
            break;
        case 'BNE':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 001 ${rdNum} 1100011`;
            break;
        case 'BLT':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 100 ${rdNum} 1100011`;
            break;
        case 'BGE':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 101 ${rdNum} 1100011`;
            break;
        case 'BLTU':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 110 ${rdNum} 1100011`;
            break;
        case 'BGEU':
            if (!imm12) return null;
            binaryInstruction = `${imm12} ${rs1Num} ${rs2Num} 111 ${rdNum} 1100011`;
            break;
        // U-type (lui and auipc)
        default:
            return null;
    }

    return binaryInstruction;
}

