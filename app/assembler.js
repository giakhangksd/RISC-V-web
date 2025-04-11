export const assembler = {
    memory: {},        // Bộ nhớ ảo (địa chỉ byte -> giá trị byte)
    labels: {},        // Bảng nhãn { labelName: { address: number, isGlobal: boolean } | number (cho .equ) }
    equValues: {},     // Lưu trữ giá trị của các hằng số .equ riêng biệt
    currentSection: null, // Section hiện tại: 'data' hoặc 'text'
    currentAddress: 0,   // Địa chỉ bộ nhớ hiện tại (tính bằng byte)
    instructionLines: [], // Mảng lưu trữ các dòng lệnh gốc để xử lý sau khi có đủ label
    binary: [],       // Mảng chứa mã nhị phân được tạo ra

    // Ánh xạ tên thanh ghi (ABI Names và MIPS-style) sang tên RISC-V chuẩn (Xn)
    registerMapping: {
        '$ZERO': 'X0', '$0': 'X0', 'ZERO': 'X0',
        '$RA': 'X1', '$1': 'X1', 'RA': 'X1',
        '$SP': 'X2', '$2': 'X2', 'SP': 'X2',
        '$GP': 'X3', '$3': 'X3', 'GP': 'X3',
        '$TP': 'X4', '$4': 'X4', 'TP': 'X4',
        '$T0': 'X5', '$5': 'X5', 'T0': 'X5',
        '$T1': 'X6', '$6': 'X6', 'T1': 'X6',
        '$T2': 'X7', '$7': 'X7', 'T2': 'X7',
        '$S0': 'X8', '$8': 'X8', 'S0': 'X8', '$FP': 'X8', 'FP': 'X8', // FP là alias của S0
        '$S1': 'X9', '$9': 'X9', 'S1': 'X9',
        '$A0': 'X10', '$10': 'X10', 'A0': 'X10',
        '$A1': 'X11', '$11': 'X11', 'A1': 'X11',
        '$A2': 'X12', '$12': 'X12', 'A2': 'X12',
        '$A3': 'X13', '$13': 'X13', 'A3': 'X13',
        '$A4': 'X14', '$14': 'X14', 'A4': 'X14',
        '$A5': 'X15', '$15': 'X15', 'A5': 'X15',
        '$A6': 'X16', '$16': 'X16', 'A6': 'X16',
        '$A7': 'X17', '$17': 'X17', 'A7': 'X17',
        '$S2': 'X18', '$18': 'X18', 'S2': 'X18',
        '$S3': 'X19', '$19': 'X19', 'S3': 'X19',
        '$S4': 'X20', '$20': 'X20', 'S4': 'X20',
        '$S5': 'X21', '$21': 'X21', 'S5': 'X21',
        '$S6': 'X22', '$22': 'X22', 'S6': 'X22',
        '$S7': 'X23', '$23': 'X23', 'S7': 'X23',
        '$S8': 'X24', '$24': 'X24', 'S8': 'X24',
        '$S9': 'X25', '$25': 'X25', 'S9': 'X25',
        '$S10': 'X26', '$26': 'X26', 'S10': 'X26',
        '$S11': 'X27', '$27': 'X27', 'S11': 'X27',
        '$T3': 'X28', '$28': 'X28', 'T3': 'X28',
        '$T4': 'X29', '$29': 'X29', 'T4': 'X29',
        '$T5': 'X30', '$30': 'X30', 'T5': 'X30',
        '$T6': 'X31', '$31': 'X31', 'T6': 'X31',
        // Thêm cả tên X0, X1,... để chuẩn hóa cả trường hợp viết hoa/thường
        'X0': 'X0', 'X1': 'X1', 'X2': 'X2', 'X3': 'X3', 'X4': 'X4', 'X5': 'X5',
        'X6': 'X6', 'X7': 'X7', 'X8': 'X8', 'X9': 'X9', 'X10': 'X10', 'X11': 'X11',
        'X12': 'X12', 'X13': 'X13', 'X14': 'X14', 'X15': 'X15', 'X16': 'X16', 'X17': 'X17',
        'X18': 'X18', 'X19': 'X19', 'X20': 'X20', 'X21': 'X21', 'X22': 'X22', 'X23': 'X23',
        'X24': 'X24', 'X25': 'X25', 'X26': 'X26', 'X27': 'X27', 'X28': 'X28', 'X29': 'X29',
        'X30': 'X30', 'X31': 'X31'
    },

    // Định nghĩa các chỉ thị assembler và hàm xử lý tương ứng
    directives: {
        ".data": { minArgs: 0, maxArgs: 1, handler: function (args) { this._handleDataDirective(args); } },
        ".text": { minArgs: 0, maxArgs: 1, handler: function (args) { this._handleTextDirective(args); } },
        ".word": { minArgs: 1, maxArgs: Infinity, handler: function (args) { this._handleWordDirective(args); } },
        ".half": { minArgs: 1, maxArgs: Infinity, handler: function (args) { this._handleHalfDirective(args); } },
        ".byte": { minArgs: 1, maxArgs: Infinity, handler: function (args) { this._handleByteDirective(args); } },
        ".ascii": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleAsciiDirective(args); } },
        ".asciiz": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleAsciizDirective(args); } },
        ".space": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleSpaceDirective(args); } },
        ".align": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleAlignDirective(args); } },
        ".global": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleGlobalDirective(args); } },
        ".globl": { minArgs: 1, maxArgs: 1, handler: function (args) { this._handleGlobalDirective(args); } }, // .globl là alias của .global
        ".extern": { minArgs: 2, maxArgs: 2, handler: function (args) { this._handleExternDirective(args); } },
        ".equ": { minArgs: 2, maxArgs: 2, handler: function (args) { this._handleEquDirective(args); } },
        // Thêm các chỉ thị khác nếu cần
    },

    // Định nghĩa định dạng các lệnh RISC-V
    instructionFormats: {
        // R-Type
        "ADD": { type: "R", opcode: "0110011", funct3: "000", funct7: "0000000" },
        "SUB": { type: "R", opcode: "0110011", funct3: "000", funct7: "0100000" },
        "SLL": { type: "R", opcode: "0110011", funct3: "001", funct7: "0000000" },
        "SLT": { type: "R", opcode: "0110011", funct3: "010", funct7: "0000000" },
        "SLTU": { type: "R", opcode: "0110011", funct3: "011", funct7: "0000000" },
        "XOR": { type: "R", opcode: "0110011", funct3: "100", funct7: "0000000" },
        "SRL": { type: "R", opcode: "0110011", funct3: "101", funct7: "0000000" },
        "SRA": { type: "R", opcode: "0110011", funct3: "101", funct7: "0100000" },
        "OR": { type: "R", opcode: "0110011", funct3: "110", funct7: "0000000" },
        "AND": { type: "R", opcode: "0110011", funct3: "111", funct7: "0000000" },
        // I-Type
        "LW": { type: "I", opcode: "0000011", funct3: "010" },
        "LH": { type: "I", opcode: "0000011", funct3: "001" },
        "LB": { type: "I", opcode: "0000011", funct3: "000" },
        "LHU": { type: "I", opcode: "0000011", funct3: "101" },
        "LBU": { type: "I", opcode: "0000011", funct3: "100" },
        "ADDI": { type: "I", opcode: "0010011", funct3: "000" },
        "SLTI": { type: "I", opcode: "0010011", funct3: "010" },
        "SLTIU": { type: "I", opcode: "0010011", funct3: "011" },
        "XORI": { type: "I", opcode: "0010011", funct3: "100" },
        "ORI": { type: "I", opcode: "0010011", funct3: "110" },
        "ANDI": { type: "I", opcode: "0010011", funct3: "111" },
        "SLLI": { type: "I", opcode: "0010011", funct3: "001", funct7: "0000000" }, // Shift amount trong imm[4:0]
        "SRLI": { type: "I", opcode: "0010011", funct3: "101", funct7: "0000000" }, // Shift amount trong imm[4:0]
        "SRAI": { type: "I", opcode: "0010011", funct3: "101", funct7: "0100000" }, // Shift amount trong imm[4:0]
        "JALR": { type: "I", opcode: "1100111", funct3: "000" },
        // S-Type
        "SW": { type: "S", opcode: "0100011", funct3: "010" },
        "SH": { type: "S", opcode: "0100011", funct3: "001" },
        "SB": { type: "S", opcode: "0100011", funct3: "000" },
        // B-Type
        "BEQ": { type: "B", opcode: "1100011", funct3: "000" },
        "BNE": { type: "B", opcode: "1100011", funct3: "001" },
        "BLT": { type: "B", opcode: "1100011", funct3: "100" },
        "BGE": { type: "B", opcode: "1100011", funct3: "101" },
        "BLTU": { type: "B", opcode: "1100011", funct3: "110" },
        "BGEU": { type: "B", opcode: "1100011", funct3: "111" },
        // U-Type
        "LUI": { type: "U", opcode: "0110111" },
        "AUIPC": { type: "U", opcode: "0010111" },
        // J-Type
        "JAL": { type: "J", opcode: "1101111" },
        // System instructions (Ví dụ: ecall)
        "ECALL": { type: "I", opcode: "1110011", funct3: "000", imm: "000000000000" }, // Immediate 12-bit là 0
        // Thêm các lệnh khác nếu cần
    },

    /**
     * Hàm chính để biên dịch mã hợp ngữ.
     * @param {string} assemblyCode - Chuỗi chứa mã hợp ngữ.
     * @returns {string[]} - Mảng chứa các chuỗi mã nhị phân.
     */
    assemble(assemblyCode) {
        // Reset trạng thái biên dịch
        this._reset();

        const lines = assemblyCode.split("\n");

        // ===== PASS 1: Xử lý chỉ thị, nhãn và tính toán địa chỉ =====
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            try {
                const parsedLine = this._parseLine(line, i); // Truyền cả số dòng để báo lỗi
                if (parsedLine) {
                    // Nếu là lệnh, tính toán địa chỉ và lưu trữ để dùng ở Pass 2
                    if (parsedLine.type === 'instruction') {
                        parsedLine.address = this.currentAddress; // Gán địa chỉ cho lệnh
                        this.currentAddress += 4; // Lệnh RISC-V dài 4 byte
                    }
                    this.instructionLines.push(parsedLine); // Lưu dòng đã phân tích
                }
            } catch (error) {
                console.error(`Error assembling line ${i + 1}: ${line}\n`, error);
                throw new Error(`Line ${i + 1}: ${error.message}`); // Re-throw với số dòng
            }
        }

        // ===== PASS 2: Sinh mã nhị phân =====
        for (const instr of this.instructionLines) {
            if (instr.type === "instruction") {
                this.currentAddress = instr.address; // Cập nhật lại currentAddress cho Pass 2
                const mc = this._riscvToBinary(instr.line);
                if (mc && typeof mc === 'string' && !mc.startsWith('Error:')) { // Chỉ push mã nhị phân hợp lệ
                    this.binary.push(mc);
                } else if (mc && mc.startsWith('Error:')) {
                    throw new Error(`Instruction "${instr.line}": ${mc}`); // Ném lỗi nếu riscvToBinary trả về lỗi
                }
            }
        }

        console.log("Assembly Pass 1 - Labels:", this.labels);
        console.log("Assembly Pass 1 - Memory:", this.memory);
        console.log("Assembly Pass 2 - Binary:", this.binary);
        return this.binary; // Trả về mảng mã nhị phân
    },

    /**
     * Reset trạng thái của assembler.
     * @private
     */
    _reset() {
        this.memory = {};
        this.labels = {};
        this.equValues = {};
        this.currentSection = null;
        this.currentAddress = 0;
        this.instructionLines = [];
        this.binary = [];
    },

    /**
     * Phân tích cú pháp một dòng mã hợp ngữ.
     * @param {string} line - Dòng mã hợp ngữ.
     * @param {number} lineNumber - Số dòng (để báo lỗi).
     * @returns {object|null} - Đối tượng biểu diễn dòng đã phân tích hoặc null.
     * @private
     */
    _parseLine(line, lineNumber) {
        line = line.trim();
        if (!line) return null;

        // Loại bỏ comment
        const commentIndex = line.indexOf("#");
        if (commentIndex !== -1) {
            line = line.substring(0, commentIndex).trim();
        }
        if (!line) return null;

        // Xử lý nhãn (Label) ở đầu dòng
        if (line.includes(':') && !line.startsWith('.')) {
            const labelEndIndex = line.indexOf(':');
            const label = line.substring(0, labelEndIndex).trim();
            const remainingLine = line.substring(labelEndIndex + 1).trim();

            // Kiểm tra tên nhãn hợp lệ (ví dụ: chỉ chứa chữ cái, số, dấu gạch dưới, bắt đầu bằng chữ cái hoặc dấu gạch dưới)
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
                throw new Error(`Invalid label name: "${label}"`);
            }

            if (this.labels[label] && this.labels[label].address !== undefined) {
                throw new Error(`Duplicate label definition: "${label}"`);
            }
            // Lưu hoặc cập nhật nhãn với địa chỉ hiện tại
            this.labels[label] = { ...this.labels[label], address: this.currentAddress };

            // Nếu có lệnh hoặc chỉ thị trên cùng dòng với nhãn, xử lý tiếp
            if (remainingLine) {
                return this._parseLine(remainingLine, lineNumber); // Đệ quy để xử lý phần còn lại
            } else {
                return { type: "label", name: label, address: this.currentAddress }; // Trả về thông tin nhãn
            }

        } else if (line.startsWith(".")) {
            // Xử lý chỉ thị (Directive)
            const parts = line.split(/\s+/);
            const directive = parts[0].toLowerCase();
            const args = parts.slice(1).join(' ').split(',').map(arg => arg.trim()).filter(arg => arg !== ''); // Xử lý tham số phức tạp hơn

            // Xử lý chuỗi trong .ascii và .asciiz
            if ((directive === '.ascii' || directive === '.asciiz') && line.includes('"')) {
                const firstQuote = line.indexOf('"');
                const lastQuote = line.lastIndexOf('"');
                if (firstQuote !== -1 && lastQuote > firstQuote) {
                    args = [line.substring(firstQuote)]; // Lấy toàn bộ chuỗi làm một tham số
                }
            }

            if (this.directives[directive]) {
                const { minArgs, maxArgs, handler } = this.directives[directive];

                // Kiểm tra số lượng tham số (linh hoạt hơn)
                if (args.length < minArgs || (maxArgs !== Infinity && args.length > maxArgs)) {
                    throw new Error(`Invalid number of arguments for directive ${directive}. Expected ${minArgs}${maxArgs === Infinity ? '+' : '-' + maxArgs}, got ${args.length}`);
                }

                handler.call(this, args); // Gọi hàm xử lý, `this` trỏ đến assembler
                return { type: "directive", name: directive, args: args }; // Trả về thông tin chỉ thị
            } else {
                throw new Error(`Unknown directive: "${directive}"`);
            }
        } else {
            // Xử lý lệnh (Instruction)
            if (this.currentSection === "text") {
                return { type: "instruction", line: line }; // Trả về dòng lệnh gốc
            } else if (this.currentSection === "data") {
                throw new Error(`Instruction "${line}" found in .data section.`);
            } else {
                console.warn(`Instruction or data "${line}" found outside of .text or .data section. Assuming .text.`);
                this.currentSection = "text"; // Mặc định là .text nếu chưa xác định
                return { type: "instruction", line: line };
            }
        }
    },

    /**
     * Chuyển đổi một lệnh hợp ngữ thành mã nhị phân.
     * @param {string} instruction - Dòng lệnh hợp ngữ gốc.
     * @returns {string|null} - Chuỗi mã nhị phân hoặc null nếu có lỗi.
     * @private
     */
    _riscvToBinary(instruction) {
        // 1. Chuẩn hóa tên thanh ghi
        const normalizedInstruction = this._normalizeRegisterNames(instruction);

        // 2. Phân tích cú pháp lệnh (đã chuẩn hóa)
        // Cần xử lý các trường hợp như lw rd, offset(rs1)
        let parts;
        const loadStoreMatch = normalizedInstruction.match(/^(\w+)\s+([^,]+),\s*(-?\d+)\((X\d+)\)$/i); // Match lw/sw rd, imm(rs1)
        if (loadStoreMatch) {
            parts = [loadStoreMatch[1], loadStoreMatch[2], loadStoreMatch[4], loadStoreMatch[3]]; // opcode, rd/rs2, rs1, imm
        } else {
            if (normalizedInstruction.match(/^(\w+)\s+([^,]+),\s*\(([^)]+)\)(-?\d+)$/i)) {
                throw new Error(`Invalid load/store format: "${instruction}". Use "OP rd, imm(rs1)" syntax`);
            }
            parts = normalizedInstruction.trim().toUpperCase().split(/[,\s()]+/); // Basic fallback parsing
        }

        const opcode = parts[0].toUpperCase();

        if (!this.instructionFormats[opcode]) {
            // Có thể là lệnh giả? (Sẽ xử lý sau)
            throw new Error(`Invalid or unsupported opcode: "${opcode}" in instruction "${instruction}"`);
        }

        const formatInfo = this.instructionFormats[opcode];
        const { type, opcode: binOpcode, funct3, funct7 } = formatInfo;

        let binaryInstruction = "";
        let rd, rs1, rs2, imm, rdEncoded, rs1Encoded, rs2Encoded, immEncoded;

        // Hàm encodeRegister và encodeImmediate nên được định nghĩa bên ngoài hoặc truyền vào
        // Để dễ đọc, tạm thời giữ bên trong nhưng nên tách ra sau
        const encodeRegister = (register) => {
            const regName = this.registerMapping[register.toUpperCase()]; // Sử dụng mapping đã chuẩn hóa
            if (!regName) {
                throw new Error(`Invalid register name: "${register}" in instruction "${instruction}"`);
            }
            const regNumber = parseInt(regName.slice(1));
            return regNumber.toString(2).padStart(5, '0');
        };

        const encodeImmediate = (immediate, format) => {
            let immValue;
            if (isNaN(parseInt(immediate))) {
                // Xử lý nhãn (label) hoặc giá trị .equ
                if (this.equValues[immediate] !== undefined) {
                    immValue = this.equValues[immediate];
                } else if (this.labels[immediate] !== undefined && this.labels[immediate].address !== null) {
                    let labelAddress = this.labels[immediate].address;
                    // Tính toán offset tương đối cho lệnh branch và jump
                    if (format === "B" || format === "J") {
                        if (this.currentSection !== "text") {
                            throw new Error(`Cannot use label "${immediate}" for branch/jump outside .text section`);
                        }
                        // Lấy địa chỉ của lệnh hiện tại từ instructionLines
                        const currentInstructionInfo = this.instructionLines.find(item => item.line === instruction);
                        const currentInstructionAddress = currentInstructionInfo ? currentInstructionInfo.address : this.currentAddress; // Fallback
                        immValue = labelAddress - currentInstructionAddress;
                    } else {
                        immValue = labelAddress; // Sử dụng địa chỉ tuyệt đối cho các lệnh khác
                    }
                } else {
                    throw new Error(`Undefined label or symbol: "${immediate}" in instruction "${instruction}"`);
                }
            } 
            else {
                // Handle hexadecimal and decimal values
                if (typeof immediate === 'string' && immediate.trim().toLowerCase().startsWith('0x')) {
                    immValue = parseInt(immediate, 16); // Convert hex to decimal
                } else {
                    immValue = parseInt(immediate, 10); // Convert decimal string to number
                }
            }

            let maxBits;
            switch (format) {
                case "I": maxBits = 12; break;
                case "S": maxBits = 12; break;
                case "B": maxBits = 13; break; // 12 bits + 1 bit sign
                case "U": maxBits = 20; break;
                case "J": maxBits = 21; break;  // 20 bits + 1 bit sign
                default: throw new Error(`Unsupported format for immediate encoding: ${format}`);
            }

            const limit = Math.pow(2, maxBits - 1);
            if (immValue < -limit || immValue >= limit) {
                throw new Error(`Immediate value ${immValue} out of range for ${format}-type instruction "${instruction}"`);
            }

            if (immValue < 0) {
                immValue = (1 << maxBits) + immValue; // Two's complement
            }
            return immValue.toString(2).padStart(maxBits, '0');
        };

        try {
            switch (type) {
                case "R":
                    if (parts.length !== 4) throw new Error(`Incorrect arguments for R-type instruction "${instruction}"`);
                    rd = parts[1];
                    rs1 = parts[2];
                    rs2 = parts[3];
                    rdEncoded = encodeRegister(rd);
                    rs1Encoded = encodeRegister(rs1);
                    rs2Encoded = encodeRegister(rs2);
                    binaryInstruction = funct7 + rs2Encoded + rs1Encoded + funct3 + rdEncoded + binOpcode;
                    break;

                case "I":
                    if (parts.length !== 4) throw new Error(`Incorrect arguments for I-type instruction "${instruction}"`);
                    rd = parts[1];
                    rs1 = parts[2];
                    imm = parts[3];
                    rdEncoded = encodeRegister(rd);
                    rs1Encoded = encodeRegister(rs1);
                    immEncoded = encodeImmediate(imm, type);

                    // Xử lý riêng cho SLLI, SRLI, SRAI
                    if (opcode === 'SLLI' || opcode === 'SRLI' || opcode === 'SRAI') {
                        const shamt = parseInt(imm) & 0x1F; // Lấy 5 bit thấp
                        immEncoded = funct7.padStart(7, '0') + shamt.toString(2).padStart(5, '0'); // Ghép funct7 và shamt
                        binaryInstruction = immEncoded + rs1Encoded + funct3 + rdEncoded + binOpcode;
                    } else {
                        binaryInstruction = immEncoded.padStart(12, '0') + rs1Encoded + funct3 + rdEncoded + binOpcode;
                    }
                    break;


                case "S":
                    if (parts.length !== 4) throw new Error(`Incorrect arguments for S-type instruction "${instruction}"`);
                    rs2 = parts[1]; // Giá trị để lưu
                    rs1 = parts[2]; // Thanh ghi địa chỉ cơ sở
                    imm = parts[3]; // Offset
                    rs1Encoded = encodeRegister(rs1);
                    rs2Encoded = encodeRegister(rs2);
                    immEncoded = encodeImmediate(imm, type);
                    // imm[11:5] + rs2 + rs1 + funct3 + imm[4:0] + opcode
                    binaryInstruction = immEncoded.slice(0, 7) + rs2Encoded + rs1Encoded + funct3 + immEncoded.slice(7) + binOpcode;
                    break;

                case "B":
                    if (parts.length !== 4) throw new Error(`Incorrect arguments for B-type instruction "${instruction}"`);
                    rs1 = parts[1];
                    rs2 = parts[2];
                    imm = parts[3]; // Label hoặc offset
                    rs1Encoded = encodeRegister(rs1);
                    rs2Encoded = encodeRegister(rs2);
                    immEncoded = encodeImmediate(imm, type);
                    // imm[12] + imm[10:5] + rs2 + rs1 + funct3 + imm[4:1] + imm[11] + opcode
                    binaryInstruction =
                        immEncoded.slice(0, 1) +  // imm[12]
                        immEncoded.slice(2, 8) +  // imm[10:5]
                        rs2Encoded +
                        rs1Encoded +
                        funct3 +
                        immEncoded.slice(8, 12) + // imm[4:1]
                        immEncoded.slice(1, 2) +  // imm[11]
                        binOpcode;
                    break;

                case "U":
                    if (parts.length !== 3) throw new Error(`Incorrect arguments for U-type instruction "${instruction}"`);
                    rd = parts[1];
                    imm = parts[2];
                    rdEncoded = encodeRegister(rd);
                    immEncoded = encodeImmediate(imm, type);
                    // imm[31:12] + rd + opcode
                    binaryInstruction = immEncoded + rdEncoded + binOpcode; // imm đã là 20 bit cao
                    break;

                case "J":
                    if (parts.length !== 3) throw new Error(`Incorrect arguments for J-type instruction "${instruction}"`);
                    rd = parts[1];
                    imm = parts[2]; // Label hoặc offset
                    rdEncoded = encodeRegister(rd);
                    immEncoded = encodeImmediate(imm, type);
                    // imm[20] + imm[10:1] + imm[11] + imm[19:12] + rd + opcode
                    binaryInstruction =
                        immEncoded.slice(0, 1) +  // imm[20]
                        immEncoded.slice(11, 21) + // imm[10:1]
                        immEncoded.slice(10, 11) + // imm[11]
                        immEncoded.slice(1, 9) +  // imm[19:12] --- Sửa logic này
                        rdEncoded +
                        binOpcode;
                    break;

                default:
                    throw new Error(`Unsupported instruction type: "${type}" for instruction "${instruction}"`);
            }
        } catch (error) {
            console.error(`Error encoding instruction "${instruction}":`, error);
            // Trả về thông báo lỗi thay vì ném lên trên nếu muốn xử lý mềm dẻo hơn
            return `Error: ${error.message}`;
        }

        if (binaryInstruction.length !== 32) {
            console.error(`Generated binary instruction length is not 32 bits for "${instruction}": L=${binaryInstruction.length}`);
            // Có thể ném lỗi ở đây
        }

        //        console.log("binary before return:", binaryInstruction)
        return binaryInstruction.replace(/ /g, ''); // Xóa khoảng trắng và trả về
    },

    /**
    * Chuẩn hóa tên thanh ghi trong một lệnh.
    * @param {string} instruction - Dòng lệnh hợp ngữ.
    * @returns {string} - Dòng lệnh với tên thanh ghi đã được chuẩn hóa sang dạng Xn.
    * @private
    */
    _normalizeRegisterNames(instruction) {
        let normalized = instruction;
        // Thay thế các alias bằng tên Xn chuẩn, ưu tiên các alias dài hơn trước
        const aliases = Object.keys(this.registerMapping).sort((a, b) => b.length - a.length);
        for (const alias of aliases) {
            const riscvName = this.registerMapping[alias];
            // Biểu thức chính quy để tìm alias (xuất hiện như một từ riêng biệt)
            const regex = new RegExp(`\\b${alias.replace('$', '\\$')}\\b`, 'gi');
            normalized = normalized.replace(regex, riscvName); // Thay thế bằng Xn
        }
        return normalized;
    },


    // --- Các hàm xử lý chỉ thị (Private methods) ---
    _handleDataDirective(args) {
        this.currentSection = "data";
        if (args.length === 1) {
            const addr = parseInt(args[0]);
            if (isNaN(addr)) throw new Error(`Invalid address for .data: ${args[0]}`);
            this.currentAddress = addr;
        }
    },
    _handleTextDirective(args) {
        this.currentSection = "text";
        if (args.length === 1) {
            const addr = parseInt(args[0]);
            if (isNaN(addr)) throw new Error(`Invalid address for .text: ${args[0]}`);
            this.currentAddress = addr;
        } else {
            // Địa chỉ mặc định cho .text nếu không được chỉ định
            this.currentAddress = 0x00400000; // Ví dụ
        }
    },
    _handleWordDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".word directive can only be used in .data section");
        }
        for (const arg of args) {
            let value = this._resolveSymbolOrValue(arg);
            this._storeValue(value, 4); // Lưu 4 byte
        }
    },
    _handleHalfDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".half directive can only be used in .data section");
        }
        for (const arg of args) {
            let value = this._resolveSymbolOrValue(arg);
            this._storeValue(value, 2); // Lưu 2 byte
        }
    },
    _handleByteDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".byte directive can only be used in .data section");
        }
        for (const arg of args) {
            let value = this._resolveSymbolOrValue(arg);
            if (value < -128 || value > 255) {
                throw new Error(`Byte value out of range: ${arg}`);
            }
            this._storeValue(value, 1); // Lưu 1 byte
        }
    },
    _handleAsciiDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".ascii directive can only be used in .data section");
        }
        const str = this._parseStringLiteral(args[0], '.ascii');
        for (let i = 0; i < str.length; i++) {
            this.memory[this.currentAddress++] = str.charCodeAt(i);
        }
    },
    _handleAsciizDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".asciiz directive can only be used in .data section");
        }
        const str = this._parseStringLiteral(args[0], '.asciiz');
        for (let i = 0; i < str.length; i++) {
            this.memory[this.currentAddress++] = str.charCodeAt(i);
        }
        this.memory[this.currentAddress++] = 0; // Thêm null terminator
    },
    _handleSpaceDirective(args) {
        if (this.currentSection !== "data") {
            throw new Error(".space directive can only be used in .data section");
        }
        const bytes = parseInt(args[0]);
        if (isNaN(bytes) || bytes < 0) { // Kiểm tra bytes âm
            throw new Error(`Invalid number of bytes in .space: ${args[0]}`);
        }
        // Thay vì tăng trực tiếp, hãy ghi byte 0 vào các vị trí bộ nhớ
        for (let i = 0; i < bytes; i++) {
            this.memory[this.currentAddress++] = 0;
        }
        // this.currentAddress += bytes; // Chỉ tăng địa chỉ mà không ghi gì
    },
    _handleAlignDirective(args) {
        if (this.currentSection !== "data" && this.currentSection !== "text") { // .align có thể dùng trong .text
            throw new Error(".align directive needs to be in .data or .text section");
        }
        const n = parseInt(args[0]);
        if (isNaN(n) || n < 0) {
            throw new Error(`Invalid alignment value: ${args[0]}`);
        }
        const align = 1 << n; // Tương đương 2**n
        const remainder = this.currentAddress % align;
        if (remainder !== 0) {
            const padding = align - remainder;
            for (let i = 0; i < padding; i++) {
                // Ghi byte 0 để căn chỉnh, quan trọng cho section .data
                if (this.currentSection === 'data') {
                    this.memory[this.currentAddress++] = 0; // Ghi byte 0 vào bộ nhớ data
                } else {
                    this.currentAddress++; // Chỉ tăng địa chỉ trong section text
                }
            }
        }
    },
    _handleGlobalDirective(args) {
        const label = args[0];
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) { // Kiểm tra tên hợp lệ
            throw new Error(`Invalid label name for .global: "${label}"`);
        }
        if (this.labels[label] !== undefined) {
            this.labels[label].isGlobal = true;
        } else {
            this.labels[label] = { address: undefined, isGlobal: true }; // Dùng undefined thay null để rõ ràng hơn
        }
    },
    _handleExternDirective(args) {
        // .extern chỉ để thông báo, không thực sự làm gì trong assembler đơn giản này
        console.warn(".extern directive is noted but not fully handled:", args);
        const label = args[0];
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
            throw new Error(`Invalid label name for .extern: "${label}"`);
        }
        // Có thể thêm vào danh sách externals nếu cần
    },
    _handleEquDirective(args) {
        const label = args[0];
        const valueStr = args[1];
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) {
            throw new Error(`Invalid label name for .equ: "${label}"`);
        }
        if (this.labels[label] !== undefined || this.equValues[label] !== undefined) {
            throw new Error(`Symbol "${label}" already defined`);
        }

        // Cố gắng phân giải giá trị (có thể là số hoặc một .equ khác)
        let value = this._resolveSymbolOrValue(valueStr); // Hàm này cần xử lý cả .equ

        this.equValues[label] = value; // Lưu vào bảng riêng cho .equ
        // Không lưu vào this.labels nữa để tránh nhầm lẫn địa chỉ
        // this.labels[label] = value;
    },


    // --- Hàm trợ giúp ---
    /**
     * Phân giải một tham số có thể là số, nhãn hoặc hằng số .equ.
     * @param {string} symbolOrValue - Tham số cần phân giải.
     * @returns {number} - Giá trị số tương ứng.
     * @private
     */
    _resolveSymbolOrValue(symbolOrValue) {
        const value = parseInt(symbolOrValue);
        if (!isNaN(value)) {
            return value; // Là số
        } else if (this.equValues[symbolOrValue] !== undefined) {
            return this.equValues[symbolOrValue]; // Là hằng số .equ
        } else if (this.labels[symbolOrValue] !== undefined && this.labels[symbolOrValue].address !== undefined) {
            return this.labels[symbolOrValue].address; // Là nhãn đã có địa chỉ
        } else {
            // Có thể trả về một giá trị đặc biệt hoặc ném lỗi tùy thuộc vào ngữ cảnh cần xử lý nhãn chưa xác định địa chỉ
            throw new Error(`Undefined symbol or label: "${symbolOrValue}"`);
        }
    },

    /**
    * Lưu trữ giá trị vào bộ nhớ ảo (little-endian).
    * @param {number} value - Giá trị cần lưu.
    * @param {number} bytes - Số byte để lưu (1, 2, hoặc 4).
    * @private
    */
    _storeValue(value, bytes) {
        for (let i = 0; i < bytes; i++) {
            const byte = (value >> (i * 8)) & 0xFF;
            this.memory[this.currentAddress++] = byte;
        }
    },
    /**
     * Phân tích cú pháp chuỗi ký tự từ chỉ thị .ascii/.asciiz.
     * @param {string} arg - Tham số chuỗi (ví dụ: "\"Hello\"").
     * @param {string} directiveName - Tên chỉ thị (để báo lỗi).
     * @returns {string} - Chuỗi đã được xử lý (loại bỏ dấu ngoặc kép).
     * @private
     */
    _parseStringLiteral(arg, directiveName) {
        if (!arg.startsWith('"') || !arg.endsWith('"')) {
            throw new Error(`Invalid string literal for ${directiveName}: ${arg}`);
        }
        // Xử lý các ký tự escape cơ bản (thêm các ký tự khác nếu cần)
        return arg.slice(1, -1)
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    },

};
