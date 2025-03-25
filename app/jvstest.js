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
    instruction = normalizeRegisterNames(instruction);

    const parts = instruction.trim().toUpperCase().split(/[ ,()]+/);

    if (parts.length < 3) {
        return null;
    }

    const opcode = parts[0];
    const rd = parts[1];
    const rs1 = parts.length === 5 ? parts[3] : parts[2];
    const rs2OrImm = parts.length === 5 ? parts[2] : parts[3]; 

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
    const rs2Num = getRegisterNumber(rs2OrImm);
    const imm = rs2OrImm && rs2OrImm.startsWith('0X') ? parseInt(rs2OrImm, 16).toString(2) : parseInt(rs2OrImm, 10).toString(2);
    if (!rdNum || !rs1Num || (!rs2Num && isNaN(parseInt(imm, 2)))) {
        return null;
    }

    let binaryInstruction = '';

    switch (opcode) {
        //R-type
        case 'SLLI':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.padStart(5, '0')} ${rs1Num} 001 ${rdNum} 0010011`;
            break;
        case 'SRLI':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.padStart(5, '0')} ${rs1Num} 101 ${rdNum} 0010011`;
            break;
        case 'SRAI':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.padStart(5, '0')} ${rs1Num} 101 ${rdNum} 0010011`;
            break;
        case 'ADD':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 000 ${rdNum} 0110011`;
            break;
        case 'SUB':
            binaryInstruction = `0100000 ${rs2Num} ${rs1Num} 000 ${rdNum} 0110011`;
            break;
        case 'SLL':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 001 ${rdNum} 0110011`;
            break;
        case 'SLT':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 010 ${rdNum} 0110011`;
            break;
        case 'SLTU':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 011 ${rdNum} 0110011`;
            break;
        case 'XOR':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 100 ${rdNum} 0110011`;
            break;
        case 'SRL':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 101 ${rdNum} 0110011`;
            break;
        case 'SRA':
            binaryInstruction = `0100000 ${rs2Num} ${rs1Num} 101 ${rdNum} 0110011`;
            break;
        case 'OR':
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 110 ${rdNum} 0110011`;
            break;
        case 'AND':
            if (!isNaN(imm)) return null;
            binaryInstruction = `0000000 ${rs2Num} ${rs1Num} 111 ${rdNum} 0110011`;
            break;
        //I-type
        case 'JALR':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 000 ${rdNum} 1100111`;
            break;
        case 'LB':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 000 ${rdNum} 0000011`;
            break;
        case 'LH':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 001 ${rdNum} 0000011`;
            break;
        case 'LW':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 010 ${rdNum} 0000011`;
            break;
        case 'LBU':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 100 ${rdNum} 0000011`;
            break;
        case 'LHU':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 101 ${rdNum} 0000011`;
            break;
        case 'ADDI':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 000 ${rdNum} 0010011`;
            break;
        case 'SLTI':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 010 ${rdNum} 0010011`;
            break;
        case 'SLTIU':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 011 ${rdNum} 0010011`;
            break;
        case 'XORI':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 100 ${rdNum} 0010011`;
            break;
        case 'ORI' :
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 110 ${rdNum} 0010011`;
            break;
        case 'ANDI':
            binaryInstruction = `${imm.padStart(12, '0')} ${rs1Num} 111 ${rdNum} 0010011`;
            break;
        //S-type
        case 'SB':
            binaryInstruction = `${imm.slice(0, 7)} ${rs2Num} ${rs1Num} 000 ${imm.slice(7)} 0100011`;
            break;
        case 'SH':
            binaryInstruction = `${imm.slice(0, 7)} ${rs2Num} ${rs1Num} 001 ${imm.slice(7)} 0100011`;
            break;
        case 'SW':
            binaryInstruction = `${imm.slice(0, 7)} ${rs2Num} ${rs1Num} 010 ${imm.slice(7)} 0100011`;
            break;
        //U-type
        case 'LUI':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.padStart(20, '0')} ${rdNum} 0110111`;
            break;
        case 'AUIPC':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.padStart(20, '0')} ${rdNum} 0010111`;
            break;
        //J-type
        case 'JAL':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(10, 20)} ${imm.slice(9, 10)} ${imm.slice(1, 9)} ${rdNum} 1101111`;
            break;
        //B-type
        case 'BEQ':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 000 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        case 'BNE':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 001 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        case 'BLT':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 100 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        case 'BGE':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 101 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        case 'BLTU':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 110 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        case 'BGEU':
            if (isNaN(imm)) return null;
            binaryInstruction = `${imm.slice(0, 1)} ${imm.slice(11, 12)} ${imm.slice(1, 5)} ${rs2Num} ${rs1Num} 111 ${imm.slice(5, 11)} ${imm.slice(12)} 1100011`;
            break;
        default:
            return null;
    }

    return binaryInstruction;
}

