// assembler.js
// Chịu trách nhiệm biên dịch mã assembly RISC-V (RV32IMF) thành mã máy.
// Thực hiện quy trình biên dịch hai lượt (two-pass) để xử lý các nhãn.

export const assembler = {
    // --- Trạng thái nội bộ của assembler, được reset mỗi khi biên dịch ---
    memory: {},              // Lưu trữ dữ liệu và mã lệnh (địa chỉ byte -> giá trị byte)
    labels: {},              // Bảng nhãn: { tenNhan: { diaChi, laToanCuc, kieu } }
    equValues: {},           // Lưu giá trị của các hằng số định nghĩa bởi .eqv
    currentSection: null,    // Section hiện tại: 'data' hoặc 'text'
    currentAddress: 0,       // Địa chỉ bộ nhớ hiện tại trong quá trình biên dịch
    instructionLines: [],    // Mảng lưu thông tin chi tiết của từng dòng mã sau Pass 1
    binaryCode: [],          // Mảng chứa các lệnh đã được mã hóa {address, binary, hex}
    textBaseAddress: 0x00400000, // Địa chỉ bắt đầu mặc định cho vùng mã .text
    dataBaseAddress: 0x10010000, // Địa chỉ bắt đầu mặc định cho vùng dữ liệu .data
    inDataSegment: false,    // Cờ cho biết có đang ở trong vùng .data hay không

    // Ánh xạ các tên thanh ghi (ABI, MIPS-style, ...) sang tên chuẩn Xn hoặc Fn để tiện xử lý
    registerMapping: {
        // Thanh ghi số nguyên (Integer Registers)
        '$ZERO': 'X0', '$0': 'X0', 'ZERO': 'X0', 'X0': 'X0',
        '$RA': 'X1', '$1': 'X1', 'RA': 'X1', 'X1': 'X1',
        '$SP': 'X2', '$2': 'X2', 'SP': 'X2', 'X2': 'X2',
        '$GP': 'X3', '$3': 'X3', 'GP': 'X3', 'X3': 'X3',
        '$TP': 'X4', '$4': 'X4', 'TP': 'X4', 'X4': 'X4',
        '$T0': 'X5', '$5': 'X5', 'T0': 'X5', 'X5': 'X5',
        '$T1': 'X6', '$6': 'X6', 'T1': 'X6', 'X6': 'X6',
        '$T2': 'X7', '$7': 'X7', 'T2': 'X7', 'X7': 'X7',
        '$S0': 'X8', '$8': 'X8', 'S0': 'X8', '$FP': 'X8', 'FP': 'X8', 'X8': 'X8',
        '$S1': 'X9', '$9': 'X9', 'S1': 'X9', 'X9': 'X9',
        '$A0': 'X10', '$10': 'X10', 'A0': 'X10', 'X10': 'X10',
        '$A1': 'X11', '$11': 'X11', 'A1': 'X11', 'X11': 'X11',
        '$A2': 'X12', '$12': 'X12', 'A2': 'X12', 'X12': 'X12',
        '$A3': 'X13', '$13': 'X13', 'A3': 'X13', 'X13': 'X13',
        '$A4': 'X14', '$14': 'X14', 'A4': 'X14', 'X14': 'X14',
        '$A5': 'X15', '$15': 'X15', 'A5': 'X15', 'X15': 'X15',
        '$A6': 'X16', '$16': 'X16', 'A6': 'X16', 'X16': 'X16',
        '$A7': 'X17', '$17': 'X17', 'A7': 'X17', 'X17': 'X17',
        '$S2': 'X18', '$18': 'X18', 'S2': 'X18', 'X18': 'X18',
        '$S3': 'X19', '$19': 'X19', 'S3': 'X19', 'X19': 'X19',
        '$S4': 'X20', '$20': 'X20', 'S4': 'X20', 'X20': 'X20',
        '$S5': 'X21', '$21': 'X21', 'S5': 'X21', 'X21': 'X21',
        '$S6': 'X22', '$22': 'X22', 'S6': 'X22', 'X22': 'X22',
        '$S7': 'X23', '$23': 'X23', 'S7': 'X23', 'X23': 'X23',
        '$S8': 'X24', '$24': 'X24', 'S8': 'X24', 'X24': 'X24',
        '$S9': 'X25', '$25': 'X25', 'S9': 'X25', 'X25': 'X25',
        '$S10': 'X26', '$26': 'X26', 'S10': 'X26', 'X26': 'X26',
        '$S11': 'X27', '$27': 'X27', 'S11': 'X27', 'X27': 'X27',
        '$T3': 'X28', '$28': 'X28', 'T3': 'X28', 'X28': 'X28',
        '$T4': 'X29', '$29': 'X29', 'T4': 'X29', 'X29': 'X29',
        '$T5': 'X30', '$30': 'X30', 'T5': 'X30', 'X30': 'X30',
        '$T6': 'X31', '$31': 'X31', 'T6': 'X31', 'X31': 'X31',
        // Thanh ghi điểm động (Floating-Point Registers)
        'F0': 'F0', 'FT0': 'F0', 'F1': 'F1', 'FT1': 'F1', 'F2': 'F2', 'FT2': 'F2',
        'F3': 'F3', 'FT3': 'F3', 'F4': 'F4', 'FT4': 'F4', 'F5': 'F5', 'FT5': 'F5',
        'F6': 'F6', 'FT6': 'F6', 'F7': 'F7', 'FT7': 'F7', 'F8': 'F8', 'FS0': 'F8',
        'F9': 'F9', 'FS1': 'F9', 'F10': 'F10', 'FA0': 'F10', 'F11': 'F11', 'FA1': 'F11',
        'F12': 'F12', 'FA2': 'F12', 'F13': 'F13', 'FA3': 'F13', 'F14': 'F14', 'FA4': 'F14',
        'F15': 'F15', 'FA5': 'F15', 'F16': 'F16', 'FA6': 'F16', 'F17': 'F17', 'FA7': 'F17',
        'F18': 'F18', 'FS2': 'F18', 'F19': 'F19', 'FS3': 'F19', 'F20': 'F20', 'FS4': 'F20',
        'F21': 'F21', 'FS5': 'F21', 'F22': 'F22', 'FS6': 'F22', 'F23': 'F23', 'FS7': 'F23',
        'F24': 'F24', 'FS8': 'F24', 'F25': 'F25', 'FS9': 'F25', 'F26': 'F26', 'FS10': 'F26',
        'F27': 'F27', 'FS11': 'F27', 'F28': 'F28', 'FT8': 'F28', 'F29': 'F29', 'FT9': 'F29',
        'F30': 'F30', 'FT10': 'F30', 'F31': 'F31', 'FT11': 'F31',
    },

    // Bảng điều phối, ánh xạ tên chỉ thị sang hàm xử lý tương ứng
    directives: {
        '.text': function (operands) { this._handleTextDirective(operands); },
        '.data': function (operands) { this._handleDataDirective(operands); },
        '.section': function (operands) { this._handleSectionDirective(operands); },
        '.word': function (operands) { this._handleWordDirective(operands); },
        '.half': function (operands) { this._handleHalfDirective(operands); },
        '.byte': function (operands) { this._handleByteDirective(operands); },
        '.float': function (operands) { this._handleFloatDirective(operands); },
        '.single': function (operands) { this._handleFloatDirective(operands); }, // Tên khác của .float
        '.ascii': function (operands) { this._handleStringDirective(operands, false); },
        '.asciiz': function (operands) { this._handleStringDirective(operands, true); },
        '.string': function (operands) { this._handleStringDirective(operands, true); }, // Tên khác của .asciiz
        '.space': function (operands) { this._handleSpaceDirective(operands); },
        '.align': function (operands) { this._handleAlignDirective(operands); },
        '.globl': function (operands) { this._handleGlobalDirective(operands); },
        '.global': function (operands) { this._handleGlobalDirective(operands); },
        '.extern': function (operands) { this._handleExternDirective(operands); },
        '.eqv': function (operands) { this._handleEquDirective(operands); },
        '.org': function (operands) { this._handleOrgDirective(operands); }, // Chỉ thị đặt địa chỉ
    },

    // Bảng định nghĩa các lệnh và thông tin mã hóa của chúng
    opcodes: {
        // ----- RV32I Base Integer Instructions -----
        'lb':    { opcode: '0000011', funct3: '000', type: 'I' }, 'lh': { opcode: '0000011', funct3: '001', type: 'I' },
        'lw':    { opcode: '0000011', funct3: '010', type: 'I' }, 'lbu': { opcode: '0000011', funct3: '100', type: 'I' },
        'lhu':   { opcode: '0000011', funct3: '101', type: 'I' }, 'sb': { opcode: '0100011', funct3: '000', type: 'S' },
        'sh':    { opcode: '0100011', funct3: '001', type: 'S' }, 'sw': { opcode: '0100011', funct3: '010', type: 'S' },
        'addi':  { opcode: '0010011', funct3: '000', type: 'I' }, 'slti': { opcode: '0010011', funct3: '010', type: 'I' },
        'sltiu': { opcode: '0010011', funct3: '011', type: 'I' }, 'xori': { opcode: '0010011', funct3: '100', type: 'I' },
        'ori':   { opcode: '0010011', funct3: '110', type: 'I' }, 'andi': { opcode: '0010011', funct3: '111', type: 'I' },
        'slli':  { opcode: '0010011', funct3: '001', funct7: '0000000', type: 'I-shamt' },
        'srli':  { opcode: '0010011', funct3: '101', funct7: '0000000', type: 'I-shamt' },
        'srai':  { opcode: '0010011', funct3: '101', funct7: '0100000', type: 'I-shamt' },
        'add':   { opcode: '0110011', funct3: '000', funct7: '0000000', type: 'R' },
        'sub':   { opcode: '0110011', funct3: '000', funct7: '0100000', type: 'R' },
        'sll':   { opcode: '0110011', funct3: '001', funct7: '0000000', type: 'R' },
        'slt':   { opcode: '0110011', funct3: '010', funct7: '0000000', type: 'R' },
        'sltu':  { opcode: '0110011', funct3: '011', funct7: '0000000', type: 'R' },
        'xor':   { opcode: '0110011', funct3: '100', funct7: '0000000', type: 'R' },
        'srl':   { opcode: '0110011', funct3: '101', funct7: '0000000', type: 'R' },
        'sra':   { opcode: '0110011', funct3: '101', funct7: '0100000', type: 'R' },
        'or':    { opcode: '0110011', funct3: '110', funct7: '0000000', type: 'R' },
        'and':   { opcode: '0110011', funct3: '111', funct7: '0000000', type: 'R' },
        'lui':   { opcode: '0110111', type: 'U' }, 'auipc': { opcode: '0010111', type: 'U' },
        'jal':   { opcode: '1101111', type: 'J' }, 'jalr': { opcode: '1100111', funct3: '000', type: 'I' },
        'beq':   { opcode: '1100011', funct3: '000', type: 'B' }, 'bne': { opcode: '1100011', funct3: '001', type: 'B' },
        'blt':   { opcode: '1100011', funct3: '100', type: 'B' }, 'bge': { opcode: '1100011', funct3: '101', type: 'B' },
        'bltu':  { opcode: '1100011', funct3: '110', type: 'B' }, 'bgeu': { opcode: '1100011', funct3: '111', type: 'B' },
        'ecall': { opcode: '1110011', funct3: '000', funct7: '0000000', type: 'I' },
        'ebreak':{ opcode: '1110011', funct3: '000', funct7: '0000001', type: 'I' },
        'fence': { opcode: '0001111', funct3: '000', type: 'I' },

        // ----- RV32M Standard Extension (Multiply/Divide) -----
        'mul':    { opcode: '0110011', funct3: '000', funct7: '0000001', type: 'R' },
        'mulh':   { opcode: '0110011', funct3: '001', funct7: '0000001', type: 'R' },
        'mulhsu': { opcode: '0110011', funct3: '010', funct7: '0000001', type: 'R' },
        'mulhu':  { opcode: '0110011', funct3: '011', funct7: '0000001', type: 'R' },
        'div':    { opcode: '0110011', funct3: '100', funct7: '0000001', type: 'R' },
        'divu':   { opcode: '0110011', funct3: '101', funct7: '0000001', type: 'R' },
        'rem':    { opcode: '0110011', funct3: '110', funct7: '0000001', type: 'R' },
        'remu':   { opcode: '0110011', funct3: '111', funct7: '0000001', type: 'R' },

        // ----- RV32F Standard Extension (Single-Precision Floating-Point) -----
        'flw': { opcode: '0000111', funct3: '010', type: 'I-FP' },
        'fsw': { opcode: '0100111', funct3: '010', type: 'S-FP' },

        'fadd.s':  { opcode: '1010011', funct7: '0000000', type: 'R-FP' },
        'fsub.s':  { opcode: '1010011', funct7: '0000100', type: 'R-FP' },
        'fmul.s':  { opcode: '1010011', funct7: '0001000', type: 'R-FP' },
        'fdiv.s':  { opcode: '1010011', funct7: '0001100', type: 'R-FP' },
        
        'fsgnj.s':  { opcode: '1010011', funct3: '000', funct7: '0010000', type: 'R-FP' },
        'fsgnjn.s': { opcode: '1010011', funct3: '001', funct7: '0010000', type: 'R-FP' },
        'fsgnjx.s': { opcode: '1010011', funct3: '010', funct7: '0010000', type: 'R-FP' },

        'fcvt.w.s':  { opcode: '1010011', funct7: '1100000', rs2_subfield: '00000', type: 'R-FP-CVT', dest_is_int: true, src1_is_fp: true },
        'fcvt.wu.s': { opcode: '1010011', funct7: '1100000', rs2_subfield: '00001', type: 'R-FP-CVT', dest_is_int: true, src1_is_fp: true },
        'fcvt.s.w':  { opcode: '1010011', funct7: '1101000', rs2_subfield: '00000', type: 'R-FP-CVT', dest_is_fp: true, src1_is_int: true },
        'fcvt.s.wu': { opcode: '1010011', funct7: '1101000', rs2_subfield: '00001', type: 'R-FP-CVT', dest_is_fp: true, src1_is_int: true },

        'feq.s': { opcode: '1010011', funct3: '010', funct7: '1010000', type: 'R-FP-CMP', dest_is_int: true },
        'flt.s': { opcode: '1010011', funct3: '001', funct7: '1010000', type: 'R-FP-CMP', dest_is_int: true },
        'fle.s': { opcode: '1010011', funct3: '000', funct7: '1010000', type: 'R-FP-CMP', dest_is_int: true },

        'fmv.x.w': { opcode: '1010011', funct3: '000', funct7: '1110000', rs2_subfield: '00000', type: 'R-FP-CVT', dest_is_int: true, src1_is_fp: true },
        'fmv.w.x': { opcode: '1010011', funct3: '000', funct7: '1111000', rs2_subfield: '00000', type: 'R-FP-CVT', dest_is_fp: true, src1_is_int: true },

        // ----- Pseudo Instructions -----
        'nop':  { type: 'Pseudo', expandsTo: 'addi', args: ['x0', 'x0', '0'] },
        'li':   { type: 'Pseudo' },
        'mv':   { type: 'Pseudo', expandsTo: 'addi', args: [null, null, '0'] },
        'j':    { type: 'Pseudo', expandsTo: 'jal', args: ['x0', null] },
        'jr':   { type: 'Pseudo', expandsTo: 'jalr', args: ['x0', null, '0'] },
        'ret':  { type: 'Pseudo', expandsTo: 'jalr', args: ['x0', 'x1', '0'] },
        'call': { type: 'Pseudo' },
        'bnez': { type: 'Pseudo', expandsTo: 'bne', args: [null, 'x0', null] },
        'beqz': { type: 'Pseudo', expandsTo: 'beq', args: [null, 'x0', null] },
        'la':   { type: 'Pseudo' },
        'fmv.s': { type: 'Pseudo', expandsTo: 'fsgnj.s', args: [null, null, null] },
        'fabs.s':{ type: 'Pseudo', expandsTo: 'fsgnjx.s', args: [null, null, null] },
        'fneg.s':{ type: 'Pseudo', expandsTo: 'fsgnjn.s', args: [null, null, null] },
    },

    // Hàm chính, điều phối quá trình biên dịch
    assemble(assemblyCode) {
        this._reset();
        this._pass1(assemblyCode);
        this._pass2();

        // Xác định địa chỉ bắt đầu của chương trình
        let startAddress = undefined;

        // Ưu tiên nhãn _start nếu có, và nằm trong vùng .text
        if (
          this.labels["_start"]?.type === "instruction" &&
          this.labels["_start"].address >= this.textBaseAddress
        ) {
          startAddress = this.labels["_start"].address;
        } else {
          // Nếu không có _start hợp lệ, tìm dòng mã đầu tiên trong .text
          const firstTextInstr = this.instructionLines.find(
            (l) =>
              (l.type === "instruction" || l.type === "pseudo-instruction") &&
              l.address >= this.textBaseAddress
          );
          startAddress = firstTextInstr
            ? firstTextInstr.address
            : this.textBaseAddress;
        }

        // Nếu có nhãn _start, đặt startAddress theo nhãn đó
        if (this.labels['_start'] !== undefined) {
            startAddress = this.labels['_start'].address;
        }

        return {
            memory: this.memory,
            startAddress: Number(startAddress) || 0,
            instructions: this.binaryCode
        };
    },

    // Lượt 1: Xây dựng bảng nhãn, tính địa chỉ và kích thước lệnh
    _pass1(assemblyCode) {
        const lines = assemblyCode.split('\n');
        this.currentAddress = this.textBaseAddress;
        this.inDataSegment = false;

        for (let i = 0; i < lines.length; i++) {
            const originalLine = lines[i];
            const lineNumber = i + 1;
            let line = originalLine.trim();

            const commentIndex = line.indexOf('#');
            if (commentIndex !== -1) line = line.substring(0, commentIndex).trim();
            if (line.length === 0) {
                this.instructionLines.push({ original: originalLine, type: 'empty', lineNumber });
                continue;
            }

            let label = null;
            const labelMatch = line.match(/^([a-zA-Z_][\w]*)\s*:/);
            if (labelMatch) {
                label = labelMatch[1];
                line = line.substring(labelMatch[0].length).trim();
                if (!/^[a-zA-Z_][\w]*$/.test(label)) throw new Error(`Line ${lineNumber}: Invalid label name "${label}"`);
                if (this.labels[label] && this.labels[label].address !== undefined) {
                     if (!(this.labels[label].isGlobal && this.labels[label].address === undefined)) {
                         throw new Error(`Line ${lineNumber}: Duplicate label "${label}"`);
                     }
                }
                this.labels[label] = { ...this.labels[label], address: this.currentAddress, type: this.inDataSegment ? 'data' : 'instruction' };
            }

            if (line.length === 0) {
                if (label) this.instructionLines.push({ original: originalLine, type: 'label-only', label: label, address: this.currentAddress, lineNumber });
                else this.instructionLines.push({ original: originalLine, type: 'empty', lineNumber });
                continue;
            }
            
            const parts = line.split(/[\s,]+/);
            const mnemonic = parts[0].trim().toLowerCase();
            const operandsString = line.substring(mnemonic.length).trim();
            const operands = this._parseOperandsSmart(operandsString);
            const lineInfo = { original: originalLine, mnemonic, operands, label, address: this.currentAddress, type: '', lineNumber, size: 0 };

            if (mnemonic.startsWith('.')) { // Xử lý chỉ thị
                lineInfo.type = 'directive';
                const handler = this.directives[mnemonic];
                if (handler) {
                    try {
                        const addrBefore = this.currentAddress;
                        handler.call(this, operands); // Gọi hàm xử lý chỉ thị
                        lineInfo.size = this.currentAddress - addrBefore;
                    } catch (e) {
                        throw new Error(`Pass 1 (Line ${lineNumber} - "${originalLine.trim()}"): Directive "${mnemonic}": ${e.message}`);
                    }
                } else {
                    throw new Error(`Line ${lineNumber}: Unknown directive "${mnemonic}"`);
                }
            } else if (this.opcodes[mnemonic]) { // Xử lý lệnh
                if (this.inDataSegment && mnemonic !== ".eqv") throw new Error(`Line ${lineNumber}: Instruction "${mnemonic}" in .data section is not allowed.`);
                const instrOpcodeInfo = this.opcodes[mnemonic];
                lineInfo.type = instrOpcodeInfo.type === 'Pseudo' ? 'pseudo-instruction' : 'instruction';

                let instrSize = 4; // Mặc định các lệnh RV32 là 4 byte
                if (lineInfo.type === 'pseudo-instruction') {
                    instrSize = this._estimatePseudoInstructionSize(mnemonic, operands, lineNumber, true);
                }
                lineInfo.size = instrSize;
                this.currentAddress += instrSize;
            } else {
                throw new Error(`Line ${lineNumber}: Unknown mnemonic "${mnemonic}"`);
            }
            this.instructionLines.push(lineInfo);
        }
    },

    // Lượt 2: Mã hóa lệnh thành mã máy
    _pass2() {
        this.binaryCode = [];
        for (const lineInfo of this.instructionLines) {
            if (lineInfo.type !== 'instruction' && lineInfo.type !== 'pseudo-instruction') continue;
            
            this.currentAddress = lineInfo.address;
            try {
                const instrMnemonic = lineInfo.mnemonic.toLowerCase();
                const instrOpcodeInfo = this.opcodes[instrMnemonic];
                if (!instrOpcodeInfo) throw new Error(`Internal: Mnemonic "${instrMnemonic}" info missing in Pass 2.`);

                const currentInstrInfo = { ...instrOpcodeInfo, mnemonic: instrMnemonic };
                let generatedBinaries = [];
                
                if (currentInstrInfo.type === 'Pseudo') {
                    generatedBinaries = this._expandAndEncodePseudo(lineInfo, currentInstrInfo);
                } else {
                    const binStr = this._encodeInstruction(currentInstrInfo, lineInfo.operands, lineInfo.address);
                    if (binStr) generatedBinaries.push(binStr);
                }

                lineInfo.binary = generatedBinaries;
                generatedBinaries.forEach((bin, idx) => {
                    const hex = '0x' + this._binToHex(bin, 8);
                    const instrAddress = lineInfo.address + (idx * 4);
                    this.binaryCode.push({ address: instrAddress, binary: bin, hex: hex });
                    this._writeBinaryToMemory(instrAddress, bin);
                });

            } catch (e) {
                throw new Error(`Pass 2 (Line ${lineInfo.lineNumber} - "${lineInfo.original.trim()}"): ${e.message}`);
            }
        }
    },

    // Đặt lại trạng thái của assembler
    _reset() {
        this.memory = {}; this.labels = {}; this.equValues = {};
        this.currentSection = null; this.currentAddress = 0;
        this.instructionLines = []; this.binaryCode = [];
        this.inDataSegment = false;
    },

    // Phân tích chuỗi toán hạng thông minh
    _parseOperandsSmart(operandsPart) {
        if (!operandsPart) return [];
        const operands = []; let currentOperand = ''; let inString = false; let parenLevel = 0;
        for (let i = 0; i < operandsPart.length; i++) {
            const char = operandsPart[i];
            if (char === '"' && (i === 0 || operandsPart[i - 1] !== '\\')) inString = !inString;
            if (char === '(' && !inString) parenLevel++; 
            if (char === ')' && !inString) parenLevel--;
            if (char === ',' && !inString && parenLevel === 0) {
                if (currentOperand.trim().length > 0) operands.push(currentOperand.trim());
                currentOperand = '';
            } else {
                currentOperand += char;
            }
        }
        if (currentOperand.trim().length > 0) operands.push(currentOperand.trim());
        return operands.filter(op => op.length > 0);
    },

    // Chuyển đổi số thập phân sang chuỗi nhị phân bù 2
    _decToBin(decimal, length) {
        let binary = (decimal >= 0) ? decimal.toString(2) : (Math.pow(2, length) + decimal).toString(2);
        if (binary.length > length) binary = binary.slice(-length);
        return binary.padStart(length, '0');
    },

    // Chuyển đổi chuỗi nhị phân sang hex
    _binToHex(binary, nibbles) {
        let hex = '';
        for (let i = 0; i < binary.length; i += 4) {
            hex += parseInt(binary.substring(i, i + 4), 2).toString(16);
        }
        return hex.toUpperCase().padStart(nibbles, '0');
    },

    // Phân tích giá trị immediate (số, nhãn, hằng)
    _parseImmediate(operand, bits, isRelative = false, isPass1 = false, instructionAddress = 0) {
        operand = operand.trim();
        let value = null;
        
        if (this.equValues[operand] !== undefined) { value = this.equValues[operand]; }
        else if (operand.match(/^[+-]?0x[0-9a-fA-F]+$/i)) { value = parseInt(operand, 16); }
        else if (operand.match(/^[+-]?\d+$/)) { value = parseInt(operand, 10); }

        if (value === null && /^[a-zA-Z_][\w]*$/.test(operand)) {
            if (this.labels[operand] && this.labels[operand].address !== undefined) {
                const labelAddress = this.labels[operand].address;
                value = isRelative ? labelAddress - instructionAddress : labelAddress;
            } else if (isPass1) { return null; } 
              else { throw new Error(`Undefined label "${operand}"`); }
        }
        if (value === null || isNaN(value)) throw new Error(`Invalid immediate value or undefined symbol: "${operand}"`);
        
        return value;
    },

    // Lấy chỉ số (0-31) của thanh ghi
    getRegisterIndex(regNameWithXF) {
        const regName = regNameWithXF.trim().toUpperCase();
        const mappedName = this.registerMapping[regName] || regName;
        const match = mappedName.match(/^[XF](\d+)$/);
        if (match) {
            const index = parseInt(match[1]);
            if (index >= 0 && index < 32) return index;
        }
        throw new Error(`Invalid register name: "${regNameWithXF}"`);
    },

    // Phân tích toán hạng dạng bộ nhớ `offset(baseRegister)`
    _parseMemoryOperand(operand) {
        const match = operand.match(/^(-?[0-9a-zA-Z_]+)?\s*\(\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\)$/);
        if (!match) throw new Error(`Invalid memory operand format: "${operand}"`);

        const offsetPart = match[1] || '0';
        const basePart = match[2];

        const offsetValue = this._parseImmediate(offsetPart, 12, false, false, this.currentAddress);
        const baseRegIndex = this.getRegisterIndex(basePart);
        if (offsetValue === null) throw new Error(`Unresolved offset symbol "${offsetPart}"`);

        return { offset: offsetValue, baseRegIndex: baseRegIndex };
    },

/**
 * Mã hóa một lệnh assembly đã được phân tích thành chuỗi nhị phân 32-bit.
 * @param {object} instrInfo - Thông tin về lệnh từ bảng opcodes.
 * @param {string[]} operands - Mảng các toán hạng của lệnh.
 * @param {number} instructionAddress - Địa chỉ của lệnh hiện tại.
 * @returns {string} - Chuỗi nhị phân 32-bit của lệnh đã mã hóa.
 */
_encodeInstruction(instrInfo, operands, instructionAddress) {
    const { type, mnemonic } = instrInfo;
    let rd_s, rs1_s, rs2_s, imm_s, binaryInstruction;

    // --- Hàm trợ giúp nội bộ ---
    const encodeReg = (regStr) => this._decToBin(this.getRegisterIndex(regStr), 5);
    const encodeImm = (immStr, bits, isRelative) => {
        const immValue = this._parseImmediate(immStr, bits, isRelative, false, instructionAddress);
        return this._decToBin(immValue, bits);
    };

    try {
        switch (type) {
            // ===================
            // == Lệnh loại R (Register-Register)
            // ===================
            case 'R':
                rd_s = encodeReg(operands[0]);
                rs1_s = encodeReg(operands[1]);
                rs2_s = encodeReg(operands[2]);
                binaryInstruction = instrInfo.funct7 + rs2_s + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                break;

            // ===================
            // == Lệnh loại I (Register-Immediate)
            // ===================
            case 'I':
            case 'I-shamt':
                // Xử lý các lệnh đặc biệt không có toán hạng
                if (mnemonic === 'ecall') {
                    binaryInstruction = '00000000000000000000000001110011'; // imm=0,rs1=0,rd=0
                    break;
                }
                if (mnemonic === 'ebreak') {
                    binaryInstruction = '00000000000100000000000001110011'; // imm=1,rs1=0,rd=0
                    break;
                }
                
                rd_s = encodeReg(operands[0]);
                
                // Xử lý các lệnh load và jalr có định dạng `offset(base)`
                if (['lw', 'lh', 'lb', 'lbu', 'lhu', 'jalr'].includes(mnemonic)) {
                    const memOp = this._parseMemoryOperand(operands[1]);
                    rs1_s = this._decToBin(memOp.baseRegIndex, 5);
                    imm_s = this._decToBin(memOp.offset, 12);
                    binaryInstruction = imm_s + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                } 
                // Xử lý các lệnh dịch bit (shift)
                else if (type === 'I-shamt') {
                    rs1_s = encodeReg(operands[1]);
                    const shamt = encodeImm(operands[2], 5, false); // shamt là 5 bit
                    binaryInstruction = instrInfo.funct7 + shamt + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                }
                // Các lệnh loại I còn lại (addi, xori, ...)
                else {
                    rs1_s = encodeReg(operands[1]);
                    imm_s = encodeImm(operands[2], 12, false); // immediate là 12 bit
                    binaryInstruction = imm_s + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                }
                break;

            // ===================
            // == Lệnh loại S (Store)
            // ===================
            case 'S':
                rs2_s = encodeReg(operands[0]); // Thanh ghi nguồn nằm ở toán hạng đầu
                const memOpS = this._parseMemoryOperand(operands[1]);
                rs1_s = this._decToBin(memOpS.baseRegIndex, 5);
                imm_s = encodeImm(String(memOpS.offset), 12, false);
                // Ghép 2 phần của immediate
                binaryInstruction = imm_s.substring(0, 7) + rs2_s + rs1_s + instrInfo.funct3 + imm_s.substring(7) + instrInfo.opcode;
                break;

            // ===================
            // == Lệnh loại B (Branch)
            // ===================
            case 'B':
                rs1_s = encodeReg(operands[0]);
                rs2_s = encodeReg(operands[1]);
                imm_s = encodeImm(operands[2], 13, true); // Immediate 13 bit, tương đối
                // Ghép các bit của immediate theo đúng thứ tự
                const imm12 = imm_s[0];
                const imm11 = imm_s[1];
                const imm10_5 = imm_s.slice(2, 8);
                const imm4_1 = imm_s.slice(8, 12);
                binaryInstruction = imm12 + imm10_5 + rs2_s + rs1_s + instrInfo.funct3 + imm4_1 + imm11 + instrInfo.opcode;
                break;

            // ===================
            // == Lệnh loại U (Upper Immediate)
            // ===================
            case 'U':
                rd_s = encodeReg(operands[0]);
                let immValue = this._parseImmediate(operands[1], 32, false, false, instructionAddress);
                // Lấy 20 bit cao của immediate (immValue << 12), sau đó lấy 32 bit nhị phân và cắt 20 bit đầu
                let imm20U = this._decToBin(immValue << 12, 32).substring(0, 20);
                binaryInstruction = imm20U + rd_s + instrInfo.opcode;
            break;
            // ===================
            // == Lệnh loại J (Jump)
            // ===================
            case 'J':
                rd_s = encodeReg(operands[0]);
                imm_s = encodeImm(operands[1], 21, true); // Immediate 21 bit, tương đối
                // Ghép các bit của immediate theo đúng thứ tự
                const imm20 = imm_s[0];
                const imm19_12 = imm_s.slice(1, 9);
                const imm11_j = imm_s[9];
                const imm10_1 = imm_s.slice(10, 20);
                binaryInstruction = imm20 + imm10_1 + imm11_j + imm19_12 + rd_s + instrInfo.opcode;
                break;
            
            // ===================================
            // == CÁC LỆNH DẤU PHẨY ĐỘNG (FLOAT)
            // ===================================
            case 'R-FP':
                rd_s = encodeReg(operands[0]);
                rs1_s = encodeReg(operands[1]);
                rs2_s = encodeReg(operands[2]);
                const rm = instrInfo.funct3 || '000'; // Chế độ làm tròn mặc định
                binaryInstruction = instrInfo.funct7 + rs2_s + rs1_s + rm + rd_s + instrInfo.opcode;
                break;
            
            case 'R-FP-CVT': // Lệnh chuyển đổi
                rd_s = encodeReg(operands[0]);
                rs1_s = encodeReg(operands[1]);
                rs2_s = instrInfo.rs2_subfield; // rs2 không phải là thanh ghi mà là một giá trị cố định
                const rm_cvt = instrInfo.funct3 || '000';
                binaryInstruction = instrInfo.funct7 + rs2_s + rs1_s + rm_cvt + rd_s + instrInfo.opcode;
                break;
                
            case 'R-FP-CMP': // Lệnh so sánh
                rd_s = encodeReg(operands[0]); // Thanh ghi đích là thanh ghi số nguyên
                rs1_s = encodeReg(operands[1]);
                rs2_s = encodeReg(operands[2]);
                binaryInstruction = instrInfo.funct7 + rs2_s + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                break;

            case 'I-FP': // FLW
                rd_s = encodeReg(operands[0]);
                const memOpIFP = this._parseMemoryOperand(operands[1]);
                rs1_s = this._decToBin(memOpIFP.baseRegIndex, 5);
                imm_s = this._decToBin(memOpIFP.offset, 12);
                binaryInstruction = imm_s + rs1_s + instrInfo.funct3 + rd_s + instrInfo.opcode;
                break;

            case 'S-FP': // FSW
                rs2_s = encodeReg(operands[0]);
                const memOpSFP = this._parseMemoryOperand(operands[1]);
                rs1_s = this._decToBin(memOpSFP.baseRegIndex, 5);
                imm_s = this._decToBin(memOpSFP.offset, 12);
                binaryInstruction = imm_s.substring(0, 7) + rs2_s + rs1_s + instrInfo.funct3 + imm_s.substring(7) + instrInfo.opcode;
                break;

            default:
                throw new Error(`Unsupported instruction type "${type}" for mnemonic "${mnemonic}"`);
        }
    } catch (e) {
        // Thêm thông tin chi tiết vào thông báo lỗi để dễ dàng gỡ lỗi
        throw new Error(`Encoding [${mnemonic} ${operands.join(', ')}]: ${e.message}`);
    }

    // Kiểm tra cuối cùng để đảm bảo mọi lệnh đều được mã hóa thành 32 bit
    if (binaryInstruction.length !== 32) {
        throw new Error(`Internal Error: Encoded binary for "${mnemonic}" is ${binaryInstruction.length} bits, expected 32.`);
    }

    return binaryInstruction;
},

    // Ước lượng kích thước của lệnh giả
    _estimatePseudoInstructionSize(mnemonic, operands, lineNumber, isPass1 = false) {
        if (mnemonic === 'li') {
            try {
                const immValue = this._parseImmediate(operands[1], 32, false, isPass1);
                if (immValue === null && isPass1) return 8; // Giả định trường hợp tệ nhất
                return (immValue >= -2048 && immValue <= 2047) ? 4 : 8;
            } catch (e) { if (isPass1) return 8; throw e; }
        }
        if (mnemonic === 'la' || mnemonic === 'call') return 8;
        return 4; // Mặc định các lệnh giả khác chiếm 4 byte
    },

    // Mở rộng lệnh giả thành lệnh thật
    _expandAndEncodePseudo(lineInfo, instrInfo) {
        const { mnemonic, operands, address } = lineInfo;
        let expandedInstructions = [];

        switch (mnemonic) {
            case 'li':
                const rdLi = operands[0];
                const immValueLi = this._parseImmediate(operands[1], 32, false, false, address);
                if (immValueLi >= -2048 && immValueLi <= 2047) {
                    expandedInstructions.push({ mnemonic: 'addi', operands: [rdLi, 'x0', immValueLi.toString()], address: address });
                } else {
                    // Chuẩn RISC-V: làm tròn lên nếu bit 11 của immValueLi là 1
                    const upper = (immValueLi + 0x800) >> 12;
                    let lower = immValueLi - (upper << 12);
                    // Sign-extend lower về 12 bit
                    if (lower < -2048) lower += 4096;
                    if (lower > 2047) lower -= 4096;
                    expandedInstructions.push({ mnemonic: 'lui', operands: [rdLi, upper.toString()], address: address });
                    if (lower !== 0 || immValueLi === 0) {
                        expandedInstructions.push({ mnemonic: 'addi', operands: [rdLi, rdLi, lower.toString()], address: address + 4 });
                    }
                }
                break;
            case 'la':
                if (operands.length !== 2) throw new Error(`'la' expects rd, symbol. Got ${operands}`);
                const rdLa = operands[0];
                const symbolLa = operands[1];
                
                // Lấy địa chỉ của nhãn đích
                const symbolAddress = this._parseImmediate(symbolLa, 32, false, false, address);
                if (symbolAddress === null) throw new Error(`Unresolved symbol "${symbolLa}" in 'la'.`);
                
                // Tính toán offset tương đối so với PC hiện tại
                const offset = symbolAddress - address;

                // Sử dụng kỹ thuật làm tròn để tính toán 2 phần của offset
                // Thêm 0x800 (nửa của 12 bit) để làm tròn lên khi bit thứ 11 của offset là 1
                const hi20 = (offset + 0x800) & 0xFFFFF000;
                const lo12 = symbolAddress - (address + hi20); // Phần còn lại chính là lo12

                // Chuyển hi20 thành immediate cho AUIPC (dịch phải 12 bit)
                const auipc_imm = hi20 >> 12;

                expandedInstructions.push({
                    mnemonic: 'auipc',
                    operands: [rdLa, auipc_imm.toString()],
                    address: address
                });
                
                // Chỉ thêm ADDI nếu phần offset thấp khác 0
                if (lo12 !== 0 || hi20 === 0) {
                     expandedInstructions.push({
                        mnemonic: 'addi',
                        operands: [rdLa, rdLa, lo12.toString()],
                        address: address + 4
                    });
                }
                break;
            case 'call':
                const targetAddressCall = this._parseImmediate(operands[0], 32, false, false, address);
                const offsetCall = targetAddressCall - address;
                let hi_call = offsetCall >>> 12;
                let lo_call = offsetCall & 0xFFF;
                if (lo_call & 0x800) hi_call++;
                const lo_call_signed = (lo_call & 0x800) ? (lo_call - 4096) : lo_call;
                expandedInstructions.push({ mnemonic: 'auipc', operands: ['ra', hi_call.toString()], address: address });
                expandedInstructions.push({ mnemonic: 'jalr', operands: ['ra', 'ra', lo_call_signed.toString()], address: address + 4 });
                break;
            // Các lệnh giả đơn giản
            case 'nop': expandedInstructions.push({ mnemonic: 'addi', operands: ['x0', 'x0', '0'], address }); break;
            case 'mv': expandedInstructions.push({ mnemonic: 'addi', operands: [operands[0], operands[1], '0'], address }); break;
            case 'j': expandedInstructions.push({ mnemonic: 'jal', operands: ['x0', operands[0]], address }); break;
            case 'jr': expandedInstructions.push({ mnemonic: 'jalr', operands: ['x0', operands[0], '0'], address }); break;
            case 'ret': expandedInstructions.push({ mnemonic: 'jalr', operands: ['x0', 'ra', '0'], address }); break;
            case 'bnez': expandedInstructions.push({ mnemonic: 'bne', operands: [operands[0], 'x0', operands[1]], address }); break;
            case 'beqz': expandedInstructions.push({ mnemonic: 'beq', operands: [operands[0], 'x0', operands[1]], address }); break;
            case 'fmv.s': expandedInstructions.push({ mnemonic: 'fsgnj.s', operands: [operands[0], operands[1], operands[1]], address }); break;
            case 'fabs.s': expandedInstructions.push({ mnemonic: 'fsgnjx.s', operands: [operands[0], operands[1], operands[1]], address }); break;
            case 'fneg.s': expandedInstructions.push({ mnemonic: 'fsgnjn.s', operands: [operands[0], operands[1], operands[1]], address }); break;
            default: throw new Error(`Expansion for pseudo instruction "${mnemonic}" not implemented.`);
        }

        return expandedInstructions.map(exp => {
            const realInstrInfo = { ...this.opcodes[exp.mnemonic], mnemonic: exp.mnemonic };
            return this._encodeInstruction(realInstrInfo, exp.operands, exp.address);
        });
    },

    // Ghi chuỗi nhị phân vào bộ nhớ (little-endian)
    _writeBinaryToMemory(address, binaryString) {
        for (let i = 0; i < 4; i++) {
            this.memory[address + i] = parseInt(binaryString.substring(32 - (i + 1) * 8, 32 - i * 8), 2);
        }
    },

    // --- Các hàm xử lý chỉ thị (Directive Handlers) ---
    _handleTextDirective(operands) {
        this.inDataSegment = false;
        this.currentSection = "text";
        if (operands.length === 1) this.currentAddress = this._parseNumericArg(operands[0], '.text address');
    },
    _handleDataDirective(operands) {
        this.inDataSegment = true;
        this.currentSection = "data";
        this.currentAddress = (operands.length === 1) ? this._parseNumericArg(operands[0], '.data address') : this.dataBaseAddress;
    },
    _handleSectionDirective(operands) {
        if (operands.length === 0) {
            throw new Error('.section directive requires a section name');
        }
        
        const sectionName = operands[0].trim();
        
        // Hỗ trợ các section phổ biến trong riscv-arch-test và RISC-V assembly
        if (sectionName === ".text.init" || sectionName === ".text") {
            this.inDataSegment = false;
            this.currentSection = "text";
            // Đặt địa chỉ về text base nếu chưa có địa chỉ cụ thể
            if (this.currentAddress < this.textBaseAddress) {
                this.currentAddress = this.textBaseAddress;
            }
        } else if (sectionName === ".data" || sectionName === ".rodata" || sectionName === ".bss") {
            this.inDataSegment = true;
            this.currentSection = "data";
            // Đặt địa chỉ về data base nếu chưa có địa chỉ cụ thể
            if (this.currentAddress < this.dataBaseAddress) {
                this.currentAddress = this.dataBaseAddress;
            }
        } else if (sectionName === ".text.startup" || sectionName === ".text.hot" || sectionName === ".text.cold") {
            // Các section text đặc biệt khác
            this.inDataSegment = false;
            this.currentSection = "text";
        } else if (sectionName === ".data.rel" || sectionName === ".data.rel.local" || sectionName === ".data.rel.ro") {
            // Các section data đặc biệt khác
            this.inDataSegment = true;
            this.currentSection = "data";
        } else {
            console.warn(`⚠️  Cảnh báo: Bỏ qua section không hỗ trợ: ${sectionName}`);
            // Bỏ qua không lỗi, nhưng không đổi section
            return;
        }
        
        // Nếu có địa chỉ được chỉ định trong operands[1]
        if (operands.length >= 2) {
            try {
                this.currentAddress = this._parseNumericArg(operands[1], `.section ${sectionName} address`);
            } catch (e) {
                // Nếu operands[1] không phải là địa chỉ, có thể là attributes, bỏ qua
                console.warn(`⚠️  Cảnh báo: Không thể parse địa chỉ cho section ${sectionName}: ${operands[1]}`);
            }
        }
    },
    _ensureDataSection(directiveName) {
        if (this.currentSection !== "data") this._handleDataDirective([]);
    },
    _alignAddress(alignmentBytes, context) {
        const remainder = this.currentAddress % alignmentBytes;
        if (remainder !== 0) this.currentAddress += alignmentBytes - remainder;
    },
    _handleAlignDirective(operands) {
        if (!this.currentSection) throw new Error(".align must be within a section");
        const exponent = this._parseNumericArg(operands[0], '.align exponent');
        this._alignAddress(1 << exponent, ".align");
    },
    _handleWordDirective(operands) {
        this._ensureDataSection(".word");
        this._alignAddress(4, ".word");
        operands.forEach(arg => this._storeValue(this._resolveSymbolOrValue(arg), 4));
    },
    _handleHalfDirective(operands) {
        this._ensureDataSection(".half");
        this._alignAddress(2, ".half");
        operands.forEach(arg => this._storeValue(this._resolveSymbolOrValue(arg), 2));
    },
    _handleByteDirective(operands) {
        this._ensureDataSection(".byte");
        operands.forEach(arg => {
            if (arg.startsWith("'") && arg.endsWith("'") && arg.length === 3) {
                this._storeValue(arg.charCodeAt(1), 1);
            } else {
                this._storeValue(this._resolveSymbolOrValue(arg), 1);
            }
        });
    },
    _handleStringDirective(operands, nullTerminated) {
        this._ensureDataSection(nullTerminated ? ".asciiz" : ".ascii");
        const str = this._parseStringLiteral(operands.join(","), nullTerminated ? ".asciiz" : ".ascii");
        for (let i = 0; i < str.length; i++) this.memory[this.currentAddress++] = str.charCodeAt(i) & 0xFF;
        if (nullTerminated) this.memory[this.currentAddress++] = 0;
    },
    _handleSpaceDirective(operands) {
        this._ensureDataSection(".space");
        const bytes = this._parseNumericArg(operands[0], '.space size');
        for (let i = 0; i < bytes; i++) this.memory[this.currentAddress++] = 0;
    },
    _handleFloatDirective(operands) {
        this._ensureDataSection(".float");
        this._alignAddress(4, ".float");
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        operands.forEach(arg => {
            const floatValue = parseFloat(arg);
            if (isNaN(floatValue)) throw new Error(`Invalid floating-point value: "${arg}"`);
            view.setFloat32(0, floatValue, true); // true for little-endian
            for (let i = 0; i < 4; i++) this.memory[this.currentAddress++] = view.getUint8(i);
        });
    },
    _handleGlobalDirective(operands) {
        const label = operands[0];
        if (!this.labels[label]) this.labels[label] = { address: undefined };
        this.labels[label].isGlobal = true;
    },
    _handleExternDirective(operands) {
        operands.forEach(label => {
            if (!this.labels[label]) this.labels[label] = { address: undefined };
            this.labels[label].isExternal = true;
        });
    },
    _handleEquDirective(operands) {
        const label = operands[0];
        if (this.equValues[label] !== undefined) throw new Error(`Symbol "${label}" already defined`);
        this.equValues[label] = this._resolveSymbolOrValue(operands[1]);
    },
    _handleOrgDirective(operands) {
        this.currentAddress = this._parseNumericArg(operands[0], '.org address');
    },

    // --- Các hàm phụ trợ cho chỉ thị ---
    _parseNumericArg(arg, context) {
        try { return this._resolveSymbolOrValue(arg); }
        catch (e) { throw new Error(`Invalid numeric/symbolic value for ${context}: "${arg}"`); }
    },
    _resolveSymbolOrValue(symbolOrValue) {
        const trimmed = symbolOrValue.trim();
        if (/^'.*'$/.test(trimmed) && trimmed.length === 3) return trimmed.charCodeAt(1);
        if (/^-?0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed, 16);
        if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
        if (this.equValues[trimmed] !== undefined) return this.equValues[trimmed];
        if (this.labels[trimmed]?.address !== undefined) return this.labels[trimmed].address;
        throw new Error(`Undefined symbol or invalid value: "${trimmed}"`);
    },
    _storeValue(value, bytes) {
        for (let i = 0; i < bytes; i++) {
            this.memory[this.currentAddress + i] = (value >> (i * 8)) & 0xFF;
        }
        this.currentAddress += bytes;
    },
    _parseStringLiteral(arg, directiveName) {
        const trimmedArg = arg.trim();
        if (!trimmedArg.startsWith('"') || !trimmedArg.endsWith('"')) {
            throw new Error(`Invalid string literal for ${directiveName}. Must be in double quotes.`);
        }
        // Xử lý các escape sequence
        return trimmedArg.slice(1, -1)
            .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
            .replace(/\\"/g, '"').replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\').replace(/\\0/g, '\0');
    },
};