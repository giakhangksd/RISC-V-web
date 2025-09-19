// simulator.js
// Mô phỏng việc thực thi mã máy RISC-V, bao gồm RV32I, RV32M và các lệnh RV32F cơ bản.

// --- TileLink-UL Bus ---
class TileLinkBus {
    constructor() {
        this.request = null;
        this.response = null;
    }
    tick(cpu, mem) {
        // Nếu có request từ CPU, chuyển sang MEM
        if (this.request && !this.response) {
            mem.receiveRequest(this.request);
            this.request = null;
        }
        // Nếu có response từ MEM, chuyển về CPU
        if (this.response) {
            cpu.receiveResponse(this.response);
            this.response = null;
        }
    }
    sendRequest(req) {
        this.request = req;
    }
    sendResponse(resp) {
        this.response = resp;
    }
}

// --- TileLink-UL Memory ---
class TileLinkULMemory {
    constructor() {
        this.mem = {};
        this.pendingRequest = null;
    }
    receiveRequest(req) {
        this.pendingRequest = req;
    }
    tick(bus) {
        if (this.pendingRequest) {
            let data = null;
            // Nếu ghi vào địa chỉ điều khiển DMA (ví dụ 0xFF00)
            if (this.pendingRequest.type === 'write' && this.pendingRequest.address === 0xFF00) {
                // Giả sử value là packed: src(16bit) | dst(8bit) | length(8bit)
                const value = this.pendingRequest.value;
                const src = (value >> 16) & 0xFFFF;
                const dst = (value >> 8) & 0xFF;
                const length = value & 0xFF;
                // Lưu thông tin DMA cho lần tick tiếp theo
                this._pendingDMA = { src, dst, length };
            } else if (this.pendingRequest.type === 'read') {
                data =
                    ((this.mem[this.pendingRequest.address + 3] ?? 0) << 24) |
                    ((this.mem[this.pendingRequest.address + 2] ?? 0) << 16) |
                    ((this.mem[this.pendingRequest.address + 1] ?? 0) << 8) |
                    (this.mem[this.pendingRequest.address] ?? 0);
            } else if (this.pendingRequest.type === 'write') {
                if (this.pendingRequest.address !== 0xFF00) {
                    this.mem[this.pendingRequest.address] = this.pendingRequest.value & 0xFF;
                    this.mem[this.pendingRequest.address + 1] = (this.pendingRequest.value >> 8) & 0xFF;
                    this.mem[this.pendingRequest.address + 2] = (this.pendingRequest.value >> 16) & 0xFF;
                    this.mem[this.pendingRequest.address + 3] = (this.pendingRequest.value >> 24) & 0xFF;
                }
            } else if (this.pendingRequest.type === 'readByte') {
                data = this.mem[this.pendingRequest.address] ?? 0;
            } else if (this.pendingRequest.type === 'writeByte') {
                this.mem[this.pendingRequest.address] = this.pendingRequest.value & 0xFF;
            }
            bus.sendResponse({ ...this.pendingRequest, data });
            this.pendingRequest = null;
        }
        // CHỈ start DMA khi KHÔNG còn pendingRequest
        if (!this.pendingRequest && this._pendingDMA && !simulator.cpu.waitingRequest && !simulator.cpu.pendingResponse) {
            const { src, dst, length } = this._pendingDMA;
            if (typeof simulator !== "undefined" && simulator.dma) {
                for (let i = 0; i < length; i++) {
                    const srcAddr = src + i;
                    console.log(`[CHECK BEFORE DMA] src[0x${srcAddr.toString(16)}]=0x${(this.mem[srcAddr] ?? 0).toString(16)}`);
                }
                simulator.dma.start(src, dst, length, () => {
                    console.log("DMA transfer completed!");
                    for (let i = 0; i < length; i++) {
                        const srcAddr = src + i;
                        const dstAddr = dst + i;
                        const srcVal = simulator.mem.mem[srcAddr];
                        const dstVal = simulator.mem.mem[dstAddr];
                        console.log(`Byte ${i}: src[0x${srcAddr.toString(16)}]=0x${(srcVal ?? 0).toString(16)}, dst[0x${dstAddr.toString(16)}]=0x${(dstVal ?? 0).toString(16)}`);
                    }
                    console.log("Kiểm tra trực tiếp vùng đích sau DMA:");
                    for (let i = 0; i < length; i++) {
                        const dstAddr = dst + i;
                        console.log(`mem[0x${dstAddr.toString(16)}]=0x${(simulator.mem.mem[dstAddr] ?? 0).toString(16)}`);
                    }
                    simulator.cpu.isRunning = false;
                });
            }
            this._pendingDMA = null;
        }
    }
    loadMemoryMap(memoryMap) {
        this.mem = { ...memoryMap };
    }
    reset() {
        this.mem = {};
        this.pendingRequest = null;
    }
}

// --- TileLink-UL CPU ---
class TileLinkCPU {
    constructor() {
        this.registers = new Int32Array(32);
        this.fregisters = new Float32Array(32);
        this.pc = 0;
        this.isRunning = false;
        this.instructionCount = 0;
        this.maxSteps = 1000000;
        this.pendingResponse = null;
        this.waitingRequest = null;
        this.resolve = null;
    }
    resetRegisters() {
        this.registers.fill(0);
        this.fregisters.fill(0.0);
        //this.pc = 0;
    }
    reset() {
        this.resetRegisters();
        this.isRunning = false;
        this.instructionCount = 0;
        this.pendingResponse = null;
        this.waitingRequest = null;
        this.resolve = null;
    }
    loadProgram(programData, memory) {
        this.reset();
        if (programData.memory) {
            memory.loadMemoryMap(programData.memory);
        }
        this.pc = programData.startAddress || 0;
    }
    
     // DECODE: Giải mã từ lệnh 32-bit thành các trường và tên lệnh
    decode(instructionWord) {
        // Trích xuất các trường bit cơ bản từ từ lệnh
        const opcode = instructionWord & 0x7F;          // 7 bit opcode
        const rd = (instructionWord >> 7) & 0x1F;       // 5 bit thanh ghi đích
        const funct3 = (instructionWord >> 12) & 0x7;   // 3 bit funct3
        const rs1 = (instructionWord >> 15) & 0x1F;     // 5 bit thanh ghi nguồn 1
        const rs2 = (instructionWord >> 20) & 0x1F;     // 5 bit thanh ghi nguồn 2 (hoặc fmt cho FP)
        const funct7 = (instructionWord >> 25) & 0x7F;  // 7 bit funct7 (hoặc 1 phần cho lệnh FP)

        // Chuyển các trường sang dạng chuỗi nhị phân để dễ so khớp
        const opcodeBin = opcode.toString(2).padStart(7, '0');
        const funct3Bin = funct3.toString(2).padStart(3, '0');
        const funct7Bin = funct7.toString(2).padStart(7, '0');

        let imm = 0;        // Giá trị immediate (nếu có)
        let type = null;    // Loại lệnh (R, I, S, B, U, J, R-FP, I-FP, S-FP, etc.)
        let opName = "UNKNOWN"; // Tên lệnh (ví dụ: ADD, LW, FADD.S)
        let rm = funct3;    // Chế độ làm tròn (rounding mode), thường từ funct3 cho lệnh FP

        // Bảng định nghĩa các lệnh và cách giải mã chúng
        // Nên đồng bộ với bảng `opcodes` trong `assembler.js`
        const instructionFormats = {
            // ----- RV32I Base -----
            "ADD":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0000000" },
            "SUB":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0100000" },
            "SLL":   { type: "R", opcode: "0110011", funct3: "001", funct7: "0000000" },
            "SLT":   { type: "R", opcode: "0110011", funct3: "010", funct7: "0000000" },
            "SLTU":  { type: "R", opcode: "0110011", funct3: "011", funct7: "0000000" },
            "XOR":   { type: "R", opcode: "0110011", funct3: "100", funct7: "0000000" },
            "SRL":   { type: "R", opcode: "0110011", funct3: "101", funct7: "0000000" },
            "SRA":   { type: "R", opcode: "0110011", funct3: "101", funct7: "0100000" },
            "OR":    { type: "R", opcode: "0110011", funct3: "110", funct7: "0000000" },
            "AND":   { type: "R", opcode: "0110011", funct3: "111", funct7: "0000000" },
            "ADDI":  { type: "I", opcode: "0010011", funct3: "000" },
            "SLTI":  { type: "I", opcode: "0010011", funct3: "010" },
            "SLTIU": { type: "I", opcode: "0010011", funct3: "011" },
            "XORI":  { type: "I", opcode: "0010011", funct3: "100" },
            "ORI":   { type: "I", opcode: "0010011", funct3: "110" },
            "ANDI":  { type: "I", opcode: "0010011", funct3: "111" },
            "SLLI":  { type: "I-shamt", opcode: "0010011", funct3: "001", funct7Matcher: "0000000" },
            "SRLI":  { type: "I-shamt", opcode: "0010011", funct3: "101", funct7Matcher: "0000000" },
            "SRAI":  { type: "I-shamt", opcode: "0010011", funct3: "101", funct7Matcher: "0100000" },
            "LW":    { type: "I", opcode: "0000011", funct3: "010" },
            "LH":    { type: "I", opcode: "0000011", funct3: "001" },
            "LB":    { type: "I", opcode: "0000011", funct3: "000" },
            "LHU":   { type: "I", opcode: "0000011", funct3: "101" },
            "LBU":   { type: "I", opcode: "0000011", funct3: "100" },
            "SW":    { type: "S", opcode: "0100011", funct3: "010" },
            "SH":    { type: "S", opcode: "0100011", funct3: "001" },
            "SB":    { type: "S", opcode: "0100011", funct3: "000" },
            "LUI":   { type: "U", opcode: "0110111" },
            "AUIPC": { type: "U", opcode: "0010111" },
            "JAL":   { type: "J", opcode: "1101111" },
            "JALR":  { type: "I", opcode: "1100111", funct3: "000" },
            "BEQ":   { type: "B", opcode: "1100011", funct3: "000" },
            "BNE":   { type: "B", opcode: "1100011", funct3: "001" },
            "BLT":   { type: "B", opcode: "1100011", funct3: "100" },
            "BGE":   { type: "B", opcode: "1100011", funct3: "101" },
            "BLTU":  { type: "B", opcode: "1100011", funct3: "110" },
            "BGEU":  { type: "B", opcode: "1100011", funct3: "111" },
            "ECALL": { type: "I", opcode: "1110011", funct3: "000", immFieldMatcher: "000000000000" },
            "EBREAK":{ type: "I", opcode: "1110011", funct3: "000", immFieldMatcher: "000000000001" },
            // ----- RV32M Extension -----
            "MUL":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0000001" },
            "MULH":  { type: "R", opcode: "0110011", funct3: "001", funct7: "0000001" },
            "MULHSU":{ type: "R", opcode: "0110011", funct3: "010", funct7: "0000001" },
            "MULHU": { type: "R", opcode: "0110011", funct3: "011", funct7: "0000001" },
            "DIV":   { type: "R", opcode: "0110011", funct3: "100", funct7: "0000001" },
            "DIVU":  { type: "R", opcode: "0110011", funct3: "101", funct7: "0000001" },
            "REM":   { type: "R", opcode: "0110011", funct3: "110", funct7: "0000001" },
            "REMU":  { type: "R", opcode: "0110011", funct3: "111", funct7: "0000001" },

            // ----- RV32F Standard Extension (Single-Precision Floating-Point) -----
            // Opcode cho FLW/FSW khác với LW/SW
            "FLW":   { type: "I-FP", opcode: "0000111", funct3: "010" }, // rd(fp), rs1(int), imm
            "FSW":   { type: "S-FP", opcode: "0100111", funct3: "010" }, // rs1(int), rs2(fp), imm

            // Opcode chung cho nhiều lệnh FP R-type: 1010011
            // funct7[6:2] (thường gọi là funct5) + rs2[1:0] (fmt=00 for .S) hoặc funct7 đầy đủ xác định phép toán
            // funct3 chứa rounding mode (rm)
            // Đối với .S, rs2 field bits [26:25] (fmt) là '00'.
            // Chúng ta sẽ dùng funct7 để xác định phép toán chính
            "FADD.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0000000" },
            "FSUB.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0000100" /*fmt=00*/ },
            "FMUL.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0001000" /*fmt=00*/ },
            "FDIV.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0001100" /*fmt=00*/ },

            // Conversions: dest_is_int, src1_is_fp hoặc ngược lại sẽ giúp execute biết thanh ghi nào là int/fp
            // rs2 field bits [26:25] (fmt) là '00' cho nguồn .S, hoặc rs2 là thanh ghi nguồn cho nguồn .W/.WU
            // Đối với fcvt.w.s, rs2 chứa chỉ số thanh ghi KHÔNG dùng, chỉ có fmt ở bit 26-25.
            // funct7[6:0] = 1100000 for FCVT.W.S/FCVT.WU.S (bit rs2[0] = 0 for W, 1 for WU)
            // funct7[6:0] = 1101000 for FCVT.S.W/FCVT.S.WU (bit rs2[0] = 0 for W, 1 for WU)
            "FCVT.W.S":  { type: "R-FP-CVT", opcode: "1010011", funct7: "1100000", rs2_subfield: "00000" /*src_fmt=S, type W*/}, // rd(int), rs1(fp), rm in funct3
            "FCVT.S.W":  { type: "R-FP-CVT", opcode: "1010011", funct7: "1101000", rs2_subfield: "00000" /*src_fmt=W, type S*/}, // rd(fp), rs1(int), rm in funct3
            // fcvt.wu.s và fcvt.s.wu tương tự, khác ở rs2_subfield (bit 0 của rs2)

            // Comparisons: rd(int), rs1(fp), rs2(fp)
            // funct7[6:2] = 10100 (bits [1:0] của funct7 không dùng). funct3 xác định loại so sánh.
            "FEQ.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "010", funct7_prefix: "10100" },
            "FLT.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "001", funct7_prefix: "10100" },
            "FLE.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "000", funct7_prefix: "10100" },

            // Moves:
            // FMV.X.W: rd(int), rs1(fp). funct7='1110000', rs2=0, funct3(rm)=0
            "FMV.X.W": { type: "R-FP-CVT", opcode: "1010011", funct7: "1110000", rs2_subfield: "00000", funct3_fixed: "000"},
            // FMV.W.X: rd(fp), rs1(int). funct7='1111000', rs2=0, funct3(rm)=0
            "FMV.W.X": { type: "R-FP-CVT", opcode: "1010011", funct7: "1111000", rs2_subfield: "00000", funct3_fixed: "000"},
        };

        // Lặp qua bảng định dạng để tìm lệnh khớp
        for (const name in instructionFormats) {
            const format = instructionFormats[name];
            let match = false;
            if (format.opcode === opcodeBin) { // Kiểm tra opcode trước
                // Phân loại dựa trên kiểu lệnh đã định nghĩa
                if (format.type === 'R' || format.type === 'R-FP' || format.type === 'R-FP-CMP') {
                    if (format.funct3 === funct3Bin || format.funct3_fixed === funct3Bin || format.funct3 === 'ANY' || format.funct3_cmp === funct3Bin) {
                        if (format.funct7 === funct7Bin || format.funct7_op === funct7Bin || format.funct7_prefix === funct7Bin.substring(0,5) ) {
                            // Đối với R-FP, rs2 chứa format (01000 cho .S). Cần kiểm tra thêm nếu lệnh yêu cầu.
                            // Ví dụ FADD.S, rs2 bits [26:25] (fmt) là 00. Bit [24:20] là rs2.
                            // Mã hóa chuẩn thường đặt fmt vào các bit rs2[26:25] khi rs2 không phải là thanh ghi nguồn thứ 3.
                            // Với lệnh .S, rs2 field thường là 01000 (fmt=00, còn lại là rs2 index).
                            // Nếu instrInfo.rs2_fmt, kiểm tra thêm rs2 (chứa fmt)
                            if (format.rs2_fmt && format.rs2_fmt !== rs2.toString(2).padStart(5, '0').substring(0,format.rs2_fmt.length)) { // rs2 chứa fmt
                                // continue; // Không khớp fmt
                            }
                            match = true;
                        }
                    }
                } else if (format.type === 'R-FP-CVT') {
                     if (format.funct3_rm === funct3Bin || format.funct3_rm === 'ANY' || format.funct3_fixed === funct3Bin) {
                        if(format.funct7 === funct7Bin || format.funct7_op === funct7Bin) {
                            // Kiểm tra rs2_subfield (thường là chỉ số thanh ghi rs2 hoặc các bit format)
                            if (format.rs2_subfield && format.rs2_subfield !== rs2.toString(2).padStart(5,'0').substring(0, format.rs2_subfield.length)) {
                                // continue;
                            }
                            match = true;
                        }
                     }
                } else if (format.type === 'I' || format.type === 'I-FP' || format.type === 'I-shamt') {
                    if (format.funct3 === funct3Bin) {
                        if (format.immFieldMatcher !== undefined) { // Dành cho ECALL, EBREAK
                            if ((instructionWord >>> 20).toString(2).padStart(12, '0') === format.immFieldMatcher) match = true;
                        } else if (format.funct7Matcher !== undefined) { // Dành cho SLLI, SRLI, SRAI
                            if (funct7Bin === format.funct7Matcher) match = true;
                        } else { // Các lệnh I-type thông thường và I-FP
                            match = true;
                        }
                    }
                } else if (format.type === 'S' || format.type === 'S-FP' || format.type === 'B') {
                    if (format.funct3 === funct3Bin) match = true;
                } else if (format.type === 'U' || format.type === 'J') {
                    match = true; // Chỉ cần opcode cho U và J type
                }
            }
            if (match) {
                opName = name;
                type = format.type;
                // Lấy rm từ funct3 nếu lệnh không phải là so sánh hoặc move có funct3 cố định
                if (type.startsWith('R-FP') && !type.endsWith('CMP') && format.funct3_fixed === undefined) {
                    rm = funct3; // funct3 chứa rounding mode
                } else if (type.startsWith('R-FP-CVT') && format.funct3_fixed === undefined) {
                    rm = funct3; // funct3 chứa rounding mode
                }
                break; // Tìm thấy lệnh, thoát vòng lặp
            }
        }

        // Trích xuất và mở rộng dấu cho giá trị immediate dựa trên loại lệnh
        if (type) {
            switch (type) {
                case "I": // Bao gồm cả ECALL/EBREAK
                case "I-FP": // Bao gồm FLW
                    imm = instructionWord >> 20; // JS '>>' tự động mở rộng dấu từ bit 31 của instructionWord
                    break;
                case "I-shamt": // SLLI, SRLI, SRAI
                    imm = (instructionWord >> 20) & 0x1F; // shamt là 5 bit không dấu
                    break;
                case "S": // Bao gồm SW
                case "S-FP": // Bao gồm FSW
                    // imm[11:5] từ instructionWord[31:25], imm[4:0] từ instructionWord[11:7]
                    imm = (((instructionWord >> 25) & 0x7F) << 5) | ((instructionWord >> 7) & 0x1F);
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFF000; // Mở rộng dấu từ bit 11 của imm
                    break;
                case "B":
                    // imm[12|10:5] và imm[4:1|11], nhân 2, mở rộng dấu
                    imm = (((instructionWord >> 31) & 0x1) << 12) | // imm[12] (bit 31 của lệnh)
                          (((instructionWord >> 7) & 0x1) << 11) |   // imm[11] (bit 7 của lệnh)
                          (((instructionWord >> 25) & 0x3F) << 5) |  // imm[10:5] (bit 30-25 của lệnh)
                          (((instructionWord >> 8) & 0xF) << 1);     // imm[4:1] (bit 11-8 của lệnh)
                    // Offset được nhân 2 nhưng đã được mã hóa sẵn, chỉ cần mở rộng dấu từ bit 12 của offset
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFE000; // Mở rộng dấu từ bit 12 của offset (bit 31 của lệnh)
                    break;
                case "U":
                    // imm[31:12] được đặt vào thanh ghi, các bit thấp là 0
                    //imm = instructionWord & 0xFFFFF000;
                    imm = instructionWord >>> 12;
                    break;
                case "J":
                    // imm[20|10:1|11|19:12], nhân 2, mở rộng dấu
                    imm = (((instructionWord >> 31) & 0x1) << 20) |    // imm[20] (bit 31)
                          (((instructionWord >> 12) & 0xFF) << 12) |  // imm[19:12] (bit 30-21 -> 19-12)
                          (((instructionWord >> 20) & 0x1) << 11) |   // imm[11] (bit 20)
                          (((instructionWord >> 21) & 0x3FF) << 1);   // imm[10:1] (bit 30-21 -> 10-1)
                    if ((instructionWord >> 31) & 1) imm |= 0xFFE00000; // Mở rộng dấu từ bit 20 của offset
                    break;
                // R-type, R-FP, R-FP-CVT, R-FP-CMP không có immediate chính từ instructionWord theo cách này
            }
        } else {
            // console.warn(`decode: Could not determine instruction type for word: 0x${instructionWord.toString(16).padStart(8, '0')}`);
        }
        // Trả về đối tượng chứa các thành phần đã giải mã
        return { opName, type, opcode: opcodeBin, rd, rs1, rs2, funct3: funct3Bin, funct7: funct7Bin, imm, rm };
    }

    // EXECUTE: Thực thi lệnh đã được giải mã
    execute(decoded, bus) {
            // Đảm bảo this.memory luôn trỏ đến simulator.mem.mem
        if (typeof simulator !== "undefined" && simulator.mem && simulator.mem.mem) {
            this.memory = simulator.mem.mem;
        }
        // Trích xuất các thành phần từ đối tượng decoded
        const { opName, type, rd, rs1, rs2, funct3, funct7, imm, rm } = decoded;

        // Đọc giá trị từ thanh ghi nguồn (x0 luôn là 0)
        // Dùng | 0 để đảm bảo kết quả là số nguyên 32-bit có dấu
        const val1_int = (rs1 === 0 && type !== 'R-FP-CVT' && type !== 'FMV.W.X') ? 0 : (this.registers[rs1] | 0); // Giá trị từ thanh ghi số nguyên rs1
        const val2_int = (rs2 === 0 && type !== 'R-FP-CVT') ? 0 : (this.registers[rs2] | 0); // Giá trị từ thanh ghi số nguyên rs2

        // Đọc giá trị từ thanh ghi FP nguồn (f0-f31)
        // Cần kiểm tra xem lệnh có dùng thanh ghi FP không
        const val1_fp = this.fregisters[rs1]; // Giá trị từ thanh ghi FP rs1
        const val2_fp = this.fregisters[rs2]; // Giá trị từ thanh ghi FP rs2

        const pc = this.pc; // PC của lệnh hiện tại (dùng cho AUIPC, JAL, JALR, Branch)

        let result_int = undefined;     // Kết quả số nguyên ghi vào thanh ghi integer rd
        let result_fp = undefined;      // Kết quả float ghi vào thanh ghi FP rd
        let memoryAddress = 0;          // Địa chỉ bộ nhớ cho lệnh load/store
        let memoryValue = 0;            // Giá trị đọc/ghi từ/vào bộ nhớ
        let branchTaken = false;        // Cờ cho biết nhánh có được thực hiện không
        let nextPc = undefined;         // PC tiếp theo nếu có jump/branch

        // Hằng số cho các trường hợp đặc biệt của phép chia/lấy dư
        const INT32_MIN = -2147483648;
        const UINT32_MAX_AS_SIGNED = -1; // Biểu diễn bit của 0xFFFFFFFF khi là số có dấu

        // console.log(`  Executing: ${opName} rd=${rd}, rs1=${rs1}, rs2=${rs2}, imm=${imm}, rm=${rm}`);

        // Thực thi dựa trên tên lệnh (opName)
        switch (opName) {
            // --- RV32I & RV32M (Integer and Multiply/Divide) ---
            case 'ADD': result_int = (val1_int + val2_int) | 0; break;
            case 'SUB': result_int = (val1_int - val2_int) | 0; break;
            case 'SLL': result_int = (val1_int << (val2_int & 0x1F)) | 0; break;
            case 'SLT': result_int = (val1_int < val2_int) ? 1 : 0; break;
            case 'SLTU': result_int = ((val1_int >>> 0) < (val2_int >>> 0)) ? 1 : 0; break;
            case 'XOR': result_int = (val1_int ^ val2_int) | 0; break;
            case 'SRL': result_int = val1_int >>> (val2_int & 0x1F); break;
            case 'SRA': result_int = val1_int >> (val2_int & 0x1F); break;
            case 'OR': result_int = (val1_int | val2_int) | 0; break;
            case 'AND': result_int = (val1_int & val2_int) | 0; break;
            case 'MUL': result_int = Math.imul(val1_int, val2_int); break;
            case 'MULH': result_int = Number((BigInt(val1_int) * BigInt(val2_int)) >> 32n); break;
            case 'MULHSU': result_int = Number((BigInt(val1_int) * BigInt(val2_int >>> 0)) >> 32n); break;
            case 'MULHU': result_int = Number((BigInt(val1_int >>> 0) * BigInt(val2_int >>> 0)) >> 32n); break;
            case 'DIV':
                if (val2_int === 0) result_int = UINT32_MAX_AS_SIGNED;
                else if (val1_int === INT32_MIN && val2_int === -1) result_int = INT32_MIN;
                else result_int = (val1_int / val2_int) | 0;
                break;
            case 'DIVU':
                if (val2_int === 0) result_int = UINT32_MAX_AS_SIGNED;
                else result_int = ((val1_int >>> 0) / (val2_int >>> 0)) | 0;
                break;
            case 'REM':
                if (val2_int === 0) result_int = val1_int;
                else if (val1_int === INT32_MIN && val2_int === -1) result_int = 0;
                else result_int = val1_int % val2_int;
                break;
            case 'REMU':
                if (val2_int === 0) result_int = val1_int >>> 0;
                else result_int = (val1_int >>> 0) % (val2_int >>> 0);
                break;
            case 'ADDI': result_int = (val1_int + imm) | 0; break;
            case 'SLTI': result_int = (val1_int < imm) ? 1 : 0; break;
            case 'SLTIU': result_int = ((val1_int >>> 0) < (imm >>> 0)) ? 1 : 0; break;
            case 'XORI': result_int = (val1_int ^ imm) | 0; break;
            case 'ORI': result_int = (val1_int | imm) | 0; break;
            case 'ANDI': result_int = (val1_int & imm) | 0; break;
            case 'SLLI': result_int = (val1_int << imm) | 0; break; // imm là shamt (0-31)
            case 'SRLI': result_int = val1_int >>> imm; break;
            case 'SRAI': result_int = val1_int >> imm; break;
            // case 'LB':
            //     memoryAddress = (val1_int + imm) | 0; memoryValue = this.memory[memoryAddress];
            //     if (memoryValue === undefined) throw new Error(`Memory read error at 0x${memoryAddress.toString(16)}`);
            //     result_int = (memoryValue & 0x80) ? (memoryValue | 0xFFFFFF00) : (memoryValue & 0xFF); // Sign-extend
            //     break;
            case 'LB':
                memoryAddress = (val1_int + imm) | 0;
                if (!this.waitingRequest && !this.pendingResponse) {
                    // Gửi request đọc byte qua bus
                    this.readByteAsync(memoryAddress, bus);
                    return { nextPc: this.pc };
                }
                if (this.pendingResponse) {
                    memoryValue = this.pendingResponse.data;
                    this.waitingRequest = null;
                    this.pendingResponse = null;
                    // Sign-extend
                    result_int = (memoryValue & 0x80) ? (memoryValue | 0xFFFFFF00) : (memoryValue & 0xFF);
                    if (rd !== 0) this.registers[rd] = result_int | 0;
                    console.log(`[CPU] LB response: PC=0x${this.pc.toString(16)}, rd=x${rd}, value=${result_int|0}`);
                    return {};
                } else {
                    // Chưa có response, tiếp tục đợi
                    return { nextPc: this.pc };
                }
            break;
            case 'LH':
                memoryAddress = (val1_int + imm) | 0;
                const lh_b0 = this.memory[memoryAddress], lh_b1 = this.memory[memoryAddress + 1];
                if (lh_b0 === undefined || lh_b1 === undefined) throw new Error(`Memory read error at 0x${memoryAddress.toString(16)}`);
                memoryValue = (lh_b1 << 8) | lh_b0; // Little-endian
                result_int = (memoryValue & 0x8000) ? (memoryValue | 0xFFFF0000) : (memoryValue & 0xFFFF); // Sign-extend
                break;
            case 'LW':
                memoryAddress = (val1_int + imm) | 0;
                if (!this.waitingRequest && !this.pendingResponse) {
                    // Gửi request đọc word qua bus
                    this.readWordAsync(memoryAddress, bus);
                    // Đợi response, không tăng PC, không thực hiện gì thêm
                    return { nextPc: this.pc };
                }  
                if (this.pendingResponse) {
                    result_int = this.pendingResponse.data;
                    this.waitingRequest = null;
                    this.pendingResponse = null;
                    // GHI GIÁ TRỊ VÀO THANH GHI ĐÍCH Ở ĐÂY
                    if (rd !== 0) this.registers[rd] = result_int | 0;
                    console.log(`[CPU] LW response: PC=0x${this.pc.toString(16)}, rd=x${rd}, value=${result_int|0}`);
                    return {}; // Đã xử lý xong, tick sẽ tự tăng PC
                } else {
                    // Chưa có response, tiếp tục đợi
                    return { nextPc: this.pc };
                }
                break;
            case 'LBU':
                memoryAddress = (val1_int + imm) | 0; memoryValue = this.memory[memoryAddress];
                if (memoryValue === undefined) throw new Error(`Memory read error at 0x${memoryAddress.toString(16)}`);
                result_int = memoryValue & 0xFF; // Zero-extend
                break;
            case 'LHU':
                memoryAddress = (val1_int + imm) | 0;
                const lhu_b0 = this.memory[memoryAddress], lhu_b1 = this.memory[memoryAddress + 1];
                if (lhu_b0 === undefined || lhu_b1 === undefined) throw new Error(`Memory read error at 0x${memoryAddress.toString(16)}`);
                memoryValue = (lhu_b1 << 8) | lhu_b0; // Little-endian
                result_int = memoryValue & 0xFFFF; // Zero-extend
                break;
            // case 'SB':
            //     memoryAddress = (val1_int + imm) | 0; this.memory[memoryAddress] = val2_int & 0xFF;
            //     console.log(`[CPU] SB: Ghi value=0x${(val2_int & 0xFF).toString(16)} vào địa chỉ 0x${memoryAddress.toString(16)}`);
            //     console.log(`[MEM] mem[0x100]=0x${(simulator.mem.mem[0x100] ?? 0).toString(16)}`);
            //     break;
            case 'SB':
                memoryAddress = (val1_int + imm) | 0;
                if (!this.waitingRequest && !this.pendingResponse) {
                    // Gửi request ghi byte qua bus
                    this.writeByteAsync(memoryAddress, val2_int & 0xFF, bus);
                    return { nextPc: this.pc };
                }
                if (this.pendingResponse) {
                    // Đã ghi xong
                    this.waitingRequest = null;
                    this.pendingResponse = null;
                    console.log(`[CPU] SB response: PC=0x${this.pc.toString(16)}`);
                    return {};
                } else {
                    // Chưa có response, tiếp tục đợi
                    return { nextPc: this.pc };
                }
            break;
            case 'SH':
                memoryAddress = (val1_int + imm) | 0;
                this.memory[memoryAddress] = val2_int & 0xFF; this.memory[memoryAddress + 1] = (val2_int >> 8) & 0xFF;
                break;
            case 'SW':
                memoryAddress = (val1_int + imm) | 0;
                console.log(`[CPU] SW: Ghi value=0x${val2_int.toString(16)} vào địa chỉ 0x${memoryAddress.toString(16)}`);
                // Kiểm tra nếu SW ghi vào vùng nguồn DMA
                if (memoryAddress >= 0x100 && memoryAddress < 0x104) {
                    console.warn(`[CẢNH BÁO] SW đang ghi vào vùng nguồn DMA tại địa chỉ 0x${memoryAddress.toString(16)}!`);
                }
                if (!this.waitingRequest && !this.pendingResponse) {
                    // Gửi request ghi word qua bus
                    this.writeWordAsync(memoryAddress, val2_int, bus);
                    // Đợi response, không tăng PC, không thực hiện gì thêm
                    return { nextPc: this.pc };
                }
                if (this.pendingResponse) {
                    // Đã ghi xong
                    this.waitingRequest = null;
                    this.pendingResponse = null;
                    console.log(`[CPU] SW response: PC=0x${this.pc.toString(16)}`);
                return {};
                } else {
                    // Chưa có response, tiếp tục đợi
                    return { nextPc: this.pc };
                }
                break;
            case 'LUI': this.registers[decoded.rd] = decoded.imm << 12; break;
            //case 'LUI': result_int = imm << 12; break;
            case 'AUIPC': result_int = (pc + imm) | 0; break;
            case 'JAL': result_int = pc + 4; nextPc = (pc + imm) | 0; break;
            case 'JALR': result_int = pc + 4; nextPc = (val1_int + imm) & ~1; break; // LSB của target phải là 0
            case 'BEQ': if (val1_int === val2_int) branchTaken = true; break;
            case 'BNE': if (val1_int !== val2_int) branchTaken = true; break;
            case 'BLT': if (val1_int < val2_int) branchTaken = true; break;
            case 'BGE': if (val1_int >= val2_int) branchTaken = true; break;
            case 'BLTU': if ((val1_int >>> 0) < (val2_int >>> 0)) branchTaken = true; break;
            case 'BGEU': if ((val1_int >>> 0) >= (val2_int >>> 0)) branchTaken = true; break;
            case 'ECALL': this.handleSyscall(); break;
            case 'EBREAK': this.isRunning = false; throw new Error("EBREAK instruction encountered.");

            // --- RV32F (Single-Precision Floating-Point) ---
            case 'FLW': // Nạp word từ bộ nhớ vào thanh ghi FP
                memoryAddress = (val1_int + imm) | 0; // val1_int là thanh ghi cơ sở (integer)
                // Đọc 4 byte từ bộ nhớ
                const flw_b0 = this.memory[memoryAddress]; const flw_b1 = this.memory[memoryAddress + 1];
                const flw_b2 = this.memory[memoryAddress + 2]; const flw_b3 = this.memory[memoryAddress + 3];
                if (flw_b0 === undefined || flw_b1 === undefined || flw_b2 === undefined || flw_b3 === undefined) {
                    throw new Error(`FLW: Memory read error at 0x${memoryAddress.toString(16)}`);
                }
                // Ghép 4 byte thành một ArrayBuffer để dùng DataView
                const flw_buffer = new ArrayBuffer(4);
                const flw_view = new DataView(flw_buffer);
                flw_view.setUint8(0, flw_b0); flw_view.setUint8(1, flw_b1);
                flw_view.setUint8(2, flw_b2); flw_view.setUint8(3, flw_b3);
                result_fp = flw_view.getFloat32(0, true); // true for little-endian
                break;

            case 'FSW': // Lưu word từ thanh ghi FP vào bộ nhớ
                memoryAddress = (val1_int + imm) | 0; // val1_int là thanh ghi cơ sở (integer)
                const fsw_float_val = val2_fp;      // val2_fp là thanh ghi FP nguồn (f-register)
                const fsw_buffer = new ArrayBuffer(4);
                const fsw_view = new DataView(fsw_buffer);
                fsw_view.setFloat32(0, fsw_float_val, true); // true for little-endian
                // Ghi 4 byte vào bộ nhớ
                for (let i = 0; i < 4; i++) {
                    this.memory[memoryAddress + i] = fsw_view.getUint8(i);
                }
                break;

            case 'FADD.S': result_fp = val1_fp + val2_fp; break; // Phép cộng FP, kết quả tự làm tròn về single khi gán vào Float32Array
            case 'FSUB.S': result_fp = val1_fp - val2_fp; break;
            case 'FMUL.S': result_fp = val1_fp * val2_fp; break;
            case 'FDIV.S':
                if (val2_fp === 0.0) { // Chia cho 0
                    result_fp = (val1_fp > 0.0 ? Infinity : (val1_fp < 0.0 ? -Infinity : NaN)); // Theo chuẩn IEEE 754
                    // RISC-V spec có thể đặt cờ DZ (Divide by Zero) và trả về +/- Infinity.
                    // Simpulator này có thể không quản lý cờ, chỉ trả về giá trị.
                } else {
                    result_fp = val1_fp / val2_fp;
                }
                break;

            case 'FCVT.W.S': // Chuyển Float (trong f[rs1]) sang Signed Word (trong x[rd])
                // rm (rounding mode) được lấy từ funct3 trong decode. Ví dụ 000=RNE, 001=RTZ
                // JavaScript Math.round (RNE-ties away from zero), Math.trunc (RTZ)
                let rounded_w;
                switch (rm) {
                    case 0b000: rounded_w = Math.round(val1_fp); break; // RNE (JS Math.round là ties away from zero)
                    case 0b001: rounded_w = Math.trunc(val1_fp); break; // RTZ
                    // Cần thêm các rounding mode khác nếu muốn đầy đủ (RDN, RUP, RMM)
                    default: rounded_w = Math.round(val1_fp); // Mặc định RNE
                }
                // Kẹp giá trị trong khoảng Int32
                if (isNaN(val1_fp) || val1_fp > 2147483647.0) rounded_w = 2147483647; // Positive overflow/NaN -> INT_MAX
                else if (val1_fp < -2147483648.0) rounded_w = -2147483648; // Negative overflow -> INT_MIN
                result_int = rounded_w | 0;
                break;

            case 'FCVT.S.W': // Chuyển Signed Word (trong x[rs1]) sang Float (trong f[rd])
                // rm (rounding mode) cũng có thể áp dụng nếu giá trị integer không thể biểu diễn chính xác
                result_fp = Number(val1_int); // Chuyển đổi trực tiếp, JS Number là double, gán vào Float32Array sẽ làm tròn.
                break;
            // Tạm thời chưa thêm FCVT.WU.S và FCVT.S.WU, chúng tương tự nhưng xử lý unsigned.

            case 'FEQ.S': // rd(int) = (f[rs1] == f[rs2]) ? 1 : 0
                // Xử lý NaN: so sánh với NaN luôn false (trừ !=)
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp === val2_fp) ? 1 : 0;
                break;
            case 'FLT.S': // rd(int) = (f[rs1] < f[rs2]) ? 1 : 0
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp < val2_fp) ? 1 : 0;
                break;
            case 'FLE.S': // rd(int) = (f[rs1] <= f[rs2]) ? 1 : 0
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp <= val2_fp) ? 1 : 0;
                break;

            case 'FMV.X.W': // Di chuyển bit pattern từ f[rs1] sang x[rd]
                const fmvxw_buffer = new ArrayBuffer(4);
                const fmvxw_view = new DataView(fmvxw_buffer);
                fmvxw_view.setFloat32(0, val1_fp, true); // true for little-endian
                result_int = fmvxw_view.getInt32(0, true); // Đọc lại dưới dạng Int32
                break;
            case 'FMV.W.X': // Di chuyển bit pattern từ x[rs1] sang f[rd]
                const fmvwx_buffer = new ArrayBuffer(4);
                const fmvwx_view = new DataView(fmvwx_buffer);
                fmvwx_view.setInt32(0, val1_int, true); // true for little-endian
                result_fp = fmvwx_view.getFloat32(0, true); // Đọc lại dưới dạng Float32
                break;

            default:
                // console.error(`Execute: Instruction ${opName} (Type: ${type}) not implemented yet.`);
                throw new Error(`Execute: Instruction ${opName} (Type: ${type}) is not implemented in the simulator.`);
        }

        // Ghi kết quả vào thanh ghi đích (nếu có)
        // Thanh ghi x0 luôn là 0 và không được ghi đè
        if (rd !== 0) {
            if (result_int !== undefined) { // Nếu kết quả là cho thanh ghi số nguyên
                this.registers[rd] = result_int | 0; // Đảm bảo ghi giá trị 32-bit có dấu
            }
            if (result_fp !== undefined) { // Nếu kết quả là cho thanh ghi FP
                this.fregisters[rd] = result_fp; // Gán trực tiếp, Float32Array sẽ xử lý
            }
        } else if (rd === 0 && (result_int !== undefined && result_int !== 0) ) {
            // console.log(`Attempted to write value ${result_int} to x0 (zero register). Write ignored.`);
        } else if (rd === 0 && (result_fp !== undefined && result_fp !== 0.0) ) {
            // console.log(`Attempted to write value ${result_fp} to f0 (if f0 treated as x0). Write to actual f0 if distinct.`);
            // Hiện tại, các lệnh FP được thiết kế để rd có thể là f0.
            // Nếu có quy tắc f0 luôn là 0.0 thì cần xử lý ở đây. RISC-V không quy định f0 luôn là 0.
            if (result_fp !== undefined) this.fregisters[rd] = result_fp; // Cho phép ghi vào f0
        }


        // Xử lý PC cho lệnh Branch sau khi tính toán branchTaken
        if (type === 'B' && branchTaken) {
            nextPc = (pc + imm) | 0; // Tính địa chỉ rẽ nhánh nếu điều kiện đúng
        }
        // console.log("--- End Execute ---");
        return { nextPc }; // Trả về đối tượng chứa nextPc (có thể là undefined nếu không phải jump/branch)
    }

    // Xử lý các System Call (ECALL)
    handleSyscall() {
        // Kiểm tra xem đang chạy trên trình duyệt hay Node.js
        const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

        const syscallId = this.registers[17]; // Thanh ghi a7 (x17) chứa mã syscall
        const arg0 = this.registers[10];      // Thanh ghi a0 (x10) chứa tham số thứ nhất
        const arg1 = this.registers[11];      // Thanh ghi a1 (x11) chứa tham số thứ hai
        const arg2 = this.registers[12];      // Thanh ghi a2 (x12) chứa tham số thứ ba

        switch (syscallId) {
            case 93: // exit (theo quy ước Linux RISC-V)
                this.isRunning = false; // Dừng vòng lặp run của simulator
                if (isBrowser) {
                    alert(`Program exited with code: ${arg0}`);
                } else {
                    // In ra console cho kịch bản kiểm thử
                    console.log(`\n[Syscall] Program exited with code: ${arg0}`);
                }
                // Giữ lại giá trị trả về trong thanh ghi a0
                if (this.registers[10] !== undefined) this.registers[10] = arg0;
                break;

            case 1: // print_int (theo quy ước RARS/SPIM)
                if (isBrowser) {
                    alert(`Print Int: ${arg0}`);
                } else {
                    console.log(`\n[Syscall] Print Int: ${arg0}`);
                }
                break;

            case 4: // print_string (theo quy ước RARS/SPIM, a0 là địa chỉ chuỗi)
                let str = "";
                let addr = arg0;
                let charByte;
                while (true) {
                    charByte = this.memory[addr];
                    if (charByte === undefined || charByte === 0) break;
                    str += String.fromCharCode(charByte);
                    addr++;
                    if (str.length > 1000) { // Giới hạn để tránh treo
                        str += "... (truncated)";
                        break;
                    }
                }
                if (isBrowser) {
                    alert(`Print String:\n${str}`);
                } else {
                    console.log(`\n[Syscall] Print String: ${str}`);
                }
                break;

            case 64: // write (theo quy ước Linux RISC-V: a0=fd, a1=buf_addr, a2=count)
                const fd_write = arg0;
                const bufAddr_write = arg1;
                const count_write = arg2;
                if (fd_write === 1) { // fd 1 là stdout
                    let outputStr = "";
                    for (let i = 0; i < count_write; i++) {
                        const byte = this.memory[bufAddr_write + i];
                        if (byte === undefined) {
                            this.registers[10] = i; // Trả về số byte đã ghi thành công
                            return;
                        }
                        outputStr += String.fromCharCode(byte);
                    }
                    if (isBrowser) {
                        alert(`Write to stdout:\n${outputStr}`);
                    } else {
                        console.log(`\n[Syscall] Write to stdout: ${outputStr}`);
                    }
                    this.registers[10] = outputStr.length; // Trả về số byte đã ghi
                } else {
                    // Xử lý cho các file descriptor không được hỗ trợ
                    const errorMsg = `Syscall write: Unsupported file descriptor ${fd_write}`;
                    if (isBrowser) {
                        alert(errorMsg);
                    } else {
                        console.warn(`\n[Syscall] ${errorMsg}`);
                    }
                    this.registers[10] = -1; // Trả về lỗi
                }
                break;

            default:
                const errorMsg = `Unsupported syscall ID: ${syscallId}`;
                if (isBrowser) {
                    alert(errorMsg);
                } else {
                    console.warn(`\n[Syscall] ${errorMsg}`);
                }
        }
    }


    tick(bus) {
            // Nếu vẫn đang chờ response thì không thực thi lệnh mới
        if (this.waitingRequest && !this.pendingResponse) {
            return;
        }
        // Lưu lại PC cũ để so sánh
        const oldPc = this.pc;

        // Thực thi lệnh nếu không chờ bus

        const mem = (typeof simulator !== "undefined" && simulator.mem && simulator.mem.mem)
        ? simulator.mem.mem: this.memory;
        const pc = this.pc;
        const inst =
            ((mem[pc + 3] ?? 0) << 24) |
            ((mem[pc + 2] ?? 0) << 16) |
            ((mem[pc + 1] ?? 0) << 8) |
            (mem[pc] ?? 0);

        // Giải mã và thực thi lệnh
        const decoded = this.decode(inst);
        const { nextPc } = this.execute(decoded, bus);

        // Cập nhật PC
        if (nextPc !== undefined) {
            this.pc = nextPc;
        } else {
            this.pc += 4;
        }
        // GHI LOG mỗi lần tick thực sự tăng PC
        if (this.pc !== oldPc) {
        console.log(`[CPU] PC: 0x${oldPc.toString(16)} -> 0x${this.pc.toString(16)}, Executed: ${decoded.opName}`);
        }
    }

    receiveResponse(resp) {
    this.pendingResponse = resp;
}

    // Gửi request đọc word
    readWordAsync(address, bus) {
        this.waitingRequest = { type: 'read', address: address | 0 };
        bus.sendRequest(this.waitingRequest);
    }

    // Gửi request đọc byte
    readByteAsync(address, bus) {
        this.waitingRequest = { type: 'readByte', address: address | 0 };
        bus.sendRequest(this.waitingRequest);
    }

    // Gửi request ghi word
    writeWordAsync(address, value, bus) {
        this.waitingRequest = { type: 'write', address: address | 0, value };
        bus.sendRequest(this.waitingRequest);
    }

    // Gửi request ghi byte
    writeByteAsync(address, value, bus) {
        this.waitingRequest = { type: 'writeByte', address: address | 0, value };
        bus.sendRequest(this.waitingRequest);
    }
}

// --- DMA Controller ---
class DMAController {
    constructor(memory) {
        this.memory = memory;
        this.isBusy = false;
        this.src = 0;
        this.dst = 0;
        this.length = 0;
        this.progress = 0;
        this.callback = null;
    }

    // Khởi động DMA copy từ src sang dst, length bytes
    start(src, dst, length, callback) {
        if (this.isBusy) throw new Error("DMA is busy!");
        this.src = src | 0;
        this.dst = dst | 0;
        this.length = length | 0;
        this.progress = 0;
        this.isBusy = true;
        this.callback = callback;
    }

    // Tick DMA: mỗi tick copy 1 byte (có thể tăng tốc nếu muốn)
    tick() {
        if (!this.isBusy) return;
        if (this.progress < this.length) {
            const srcAddr = this.src + this.progress;
            const dstAddr = this.dst + this.progress;
            this.memory[dstAddr] = this.memory[srcAddr] ?? 0;
            console.log(`[DMA WRITE] mem[0x${dstAddr.toString(16)}]=0x${(this.memory[dstAddr] ?? 0).toString(16)} (src=0x${srcAddr.toString(16)}, val=0x${(this.memory[srcAddr] ?? 0).toString(16)})`);
            this.progress++;
            // Sửa log để hiện địa chỉ thực tế
            console.log(`[DMA] src=0x${srcAddr.toString(16)}, dst=0x${dstAddr.toString(16)}, length=${this.length}, progress=${this.progress}/${this.length}, busy=${this.isBusy}`);
        }
        if (this.progress >= this.length) {
            this.isBusy = false;
            if (typeof this.callback === "function") this.callback();
        }
    }
}

// --- Simulator ---
export const simulator = {
    cpu: null,
    bus: null,
    mem: null,
    tilelinkMem: null, // Để tương thích với code cũ
    dma: null, // Thêm DMA controller
    cycleCount: 0,

    reset() {
        this.cpu = new TileLinkCPU();
        this.bus = new TileLinkBus();
        this.mem = new TileLinkULMemory();
        this.tilelinkMem = this.mem; // Cho phép code cũ truy cập simulator.tilelinkMem
        this.dma = new DMAController(this.mem.mem); // Khởi tạo DMA controller
        this.cycleCount = 0;
    },
    loadProgram(programData) {
        this.cpu.loadProgram(programData, this.mem);
        this.cpu.isRunning = true;
        this.dma.memory = this.mem.mem; // Đảm bảo DMA dùng vùng nhớ mới nhất
    },
    tick() {
        // Nếu CPU dừng và DMA không chạy thì dừng hoàn toàn
        if (this.cpu.isRunning === false && (!this.dma || !this.dma.isBusy)) {
            console.log("Simulation halted.");
            return;
        }
        // Nếu CPU dừng nhưng DMA vẫn đang chạy thì chỉ tick DMA
        if (this.cpu.isRunning === false && this.dma && this.dma.isBusy) {
            this.dma.tick();
            this.cycleCount++;
            return;
        }
        try {
            if (this.cpu.isRunning) {
                this.cpu.tick(this.bus);
                console.log(`[Cycle ${this.cycleCount + 1}] BUS request:`, this.bus.request, "BUS response:", this.bus.response);
                this.bus.tick(this.cpu, this.mem);
                console.log(`[Cycle ${this.cycleCount + 1}] MEM pendingRequest:`, this.mem.pendingRequest);
                this.mem.tick(this.bus);
                console.log(`[Cycle ${this.cycleCount + 1}] CPU waitingRequest:`, this.cpu.waitingRequest, "CPU pendingResponse:", this.cpu.pendingResponse);
            }
        } catch (e) {
            this.cpu.isRunning = false;
            console.error(e);
        }
        // Chỉ tick DMA nếu CPU đang chạy (để tránh tick DMA lặp lại khi CPU đã dừng)
        if (this.cpu.isRunning && this.dma.isBusy) {
            this.dma.tick();
        }
        this.cycleCount++;
    }
};

simulator.reset();
console.log("DMA memory === MEM memory:", simulator.dma.memory === simulator.mem.mem);
console.log("MEM memory === tilelinkMem memory:", simulator.mem.mem === simulator.tilelinkMem.mem);

function tickUntilDMA() {
    let foundSW_DMA = false;
    let maxTicks = 1000;
    for (let i = 0; i < maxTicks; i++) {
        simulator.tick();
        // Đợi cho đến khi SW packed value DMA đã gửi request và tất cả request đã xử lý xong
        if (
            simulator.mem._pendingDMA && // Đã nhận packed value
            !simulator.mem.pendingRequest &&
            !simulator.cpu.waitingRequest &&
            !simulator.cpu.pendingResponse
        ) {
            foundSW_DMA = true;
            simulator.cpu.isRunning = false;
            break;
        }
    }
    if (!foundSW_DMA) {
        console.warn("Không tìm thấy lệnh SW packed value DMA sau khi tick!");
        return;
    }
    // Chỉ tick DMA cho đến khi xong
    while (simulator.dma.isBusy) {
        simulator.tick(); // tick chỉ DMA
    }
    // Kiểm tra vùng nguồn và vùng đích
    for (let i = 0; i < 4; i++) {
        const srcAddr = 0x100 + i;
        const dstAddr = 0x20 + i;
        console.log(`Sau DMA: src[0x${srcAddr.toString(16)}]=0x${(simulator.mem.mem[srcAddr] ?? 0).toString(16)}, dst[0x${dstAddr.toString(16)}]=0x${(simulator.mem.mem[dstAddr] ?? 0).toString(16)}`);
    }
}
tickUntilDMA();