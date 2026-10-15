#include <cstddef>
#include "Processing.NDI.Lib.h"
#include <chrono>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>
using Clock = std::chrono::steady_clock;
int main(int argc, char** argv) {
  if (argc != 2 || !NDIlib_initialize()) return 2;
  auto finder = NDIlib_find_create_v2();
  if (!finder) { NDIlib_destroy(); return 5; }
  NDIlib_source_t selected;
  std::string sourceName, sourceUrl;
  auto deadline = Clock::now() + std::chrono::seconds(30);
  while (Clock::now() < deadline && sourceName.empty()) {
    uint32_t count = 0;
    auto sources = NDIlib_find_get_current_sources(finder, &count);
    for (uint32_t i = 0; i < count; i++) if (std::strstr(sources[i].p_ndi_name, argv[1])) {
      sourceName = sources[i].p_ndi_name;
      sourceUrl = sources[i].p_url_address ? sources[i].p_url_address : "";
      break;
    }
    if (sourceName.empty()) NDIlib_find_wait_for_sources(finder, 100);
  }
  if (sourceName.empty()) { NDIlib_find_destroy(finder); NDIlib_destroy(); return 3; }
  selected.p_ndi_name = sourceName.c_str(); selected.p_url_address = sourceUrl.c_str();
  NDIlib_recv_create_v3_t config(selected, NDIlib_recv_color_format_RGBX_RGBA, NDIlib_recv_bandwidth_highest, false, "Rhema disposable QA receiver");
  auto receiver = NDIlib_recv_create_v3(&config);
  NDIlib_find_destroy(finder);
  if (!receiver) { NDIlib_destroy(); return 4; }
  deadline = Clock::now() + std::chrono::seconds(45);
  int terminalFrames = 0;
  while (Clock::now() < deadline) {
    NDIlib_video_frame_v2_t frame;
    if (NDIlib_recv_capture_v2(receiver, &frame, nullptr, nullptr, 100) == NDIlib_frame_type_video) {
      auto epoch = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
      std::cout << "{\"receivedMs\":" << epoch << ",\"width\":" << frame.xres << ",\"height\":" << frame.yres << ",\"rateN\":" << frame.frame_rate_N << ",\"rateD\":" << frame.frame_rate_D << ",\"pixel\":[" << int(frame.p_data[0]) << "," << int(frame.p_data[1]) << "," << int(frame.p_data[2]) << "," << int(frame.p_data[3]) << "],\"metadata\":" << std::quoted(frame.p_metadata ? frame.p_metadata : "") << "}" << std::endl;
      terminalFrames = frame.p_metadata && std::strstr(frame.p_metadata, "revision=\"111\"") ? terminalFrames + 1 : 0;
      NDIlib_recv_free_video_v2(receiver, &frame);
      if (terminalFrames >= 5) break;
    }
  }
  NDIlib_recv_destroy(receiver); NDIlib_destroy(); return terminalFrames >= 5 ? 0 : 6;
}
