## Project Objectives

### Vision

Create a **universal HbbTV MediaSync application**, open source and maintained by the community of HbbTV members, enabling complementary content to be played on a second device, such as a mobile phone or tablet, **perfectly synchronized** with the main TV content.

The goal is to provide **a single application for all broadcasters** that want to enable second-screen experiences, avoiding the need for each broadcaster to develop and maintain its own dedicated app.

### Value Proposition

* **Minimal adoption effort for broadcasters.** Joining the initiative should be as simple as **adding a small code snippet** that:

  1. Enables MediaSync for the selected content.
  2. Specifies which complementary content should be offered on the second screen.

* **Frictionless user experience.** Activation for the viewer should be as direct and seamless as possible.

### How It Works

1. The mobile application **discovers devices on the Wi-Fi network** that have MediaSync enabled, using the **DIAL** protocol.
2. The user selects the TV set.
3. The app **reads the DASH manifest (MPD)** of the main content.
4. It presents the user with the **available audio and video tracks** announced in the manifest.
5. The user selects the desired track, which is then played **with precise synchronization** using **DVB-CSS** with the content displayed on the main TV.

### Licensing and Distribution Model

* The project will be released under a **MIT license**, allowing broadcasters to **fork** it and create their own customized or branded version.
* Maintenance will be **open and community-driven**, allowing any HbbTV member to propose and contribute new features.
